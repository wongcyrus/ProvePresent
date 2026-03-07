/**
 * Student Session View Page
 */

import { useEffect, useState } from 'react';
import { getAuthHeaders, getAuthEndpoint } from '../utils/authHeaders';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { SimpleStudentView } from '../components/SimpleStudentView';
import { getCurrentLocationWithError } from '../utils/geolocation';

const QrReader = dynamic(
  () => import('react-qr-reader').then((mod) => mod.QrReader),
  { ssr: false }
);

interface UserInfo {
  userId: string;
  userDetails: string;
  userRoles: string[];
}

function getRolesFromEmail(email: string): string[] {
  const roles: string[] = ['authenticated'];
  if (!email) return roles;
  const emailLower = email.toLowerCase();
  if (emailLower.endsWith('@stu.vtc.edu.hk')) {
    roles.push('student');
  } else if (emailLower.endsWith('@vtc.edu.hk')) {
    roles.push('teacher');
  }
  return roles;
}

function parseStudentQRPayload(rawText: string): { sessionId: string; type?: string; token?: string } | null {
  const value = rawText.trim();
  if (!value) return null;

  try {
    const parsedUrl = new URL(
      value,
      typeof window !== 'undefined' ? window.location.origin : 'https://localhost'
    );
    const sessionId = parsedUrl.searchParams.get('sessionId');
    if (!sessionId) {
      return null;
    }

    return {
      sessionId,
      type: parsedUrl.searchParams.get('type') || undefined,
      token: parsedUrl.searchParams.get('token') || undefined,
    };
  } catch {
    return null;
  }
}

function extractScannedText(result: unknown): string {
  if (!result) return '';

  if (typeof result === 'string') {
    return result;
  }

  if (typeof result === 'object') {
    const candidate = result as {
      text?: string;
      rawValue?: string;
      getText?: () => string;
    };

    if (typeof candidate.text === 'string' && candidate.text) {
      return candidate.text;
    }

    if (typeof candidate.rawValue === 'string' && candidate.rawValue) {
      return candidate.rawValue;
    }

    if (typeof candidate.getText === 'function') {
      const value = candidate.getText();
      if (typeof value === 'string') {
        return value;
      }
    }
  }

  return '';
}

export default function StudentPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locationWarning, setLocationWarning] = useState<string | null>(null);
  const [hasAutoJoined, setHasAutoJoined] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [scannerEnabled, setScannerEnabled] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [lastScannedText, setLastScannedText] = useState<string | null>(null);
  
  // Get query params safely (only after mounting)
  const sessionId = mounted ? router.query.sessionId : undefined;
  const type = mounted ? router.query.type : undefined;
  const token = mounted ? router.query.token : undefined;
  const chainId = mounted ? router.query.chainId : undefined;
  const tokenId = mounted ? router.query.tokenId : undefined;

  // Handle mounting to prevent SSR issues
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return; // Don't run on server-side
    
    // Use getAuthEndpoint helper
    const authEndpoint = getAuthEndpoint();
    
    fetch(authEndpoint, {
      credentials: 'include',
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    })
      .then(res => res.json())
      .then(data => {
        if (data.clientPrincipal) {
          const email = data.clientPrincipal.userDetails || '';
          // Always compute roles from email (don't rely on Azure AD roles)
          const roles = getRolesFromEmail(email);
          
          setUser({
            userId: data.clientPrincipal.userId,
            userDetails: email,
            userRoles: roles
          });

          // Check if user has student role
          if (!roles.includes('student')) {
            router.push('/');
          } else {
            // If no sessionId in URL, check localStorage for active session
            if (!sessionId && typeof window !== 'undefined') {
              const storedSessionId = localStorage.getItem('activeSessionId');
              if (storedSessionId) {
                // Restore session from localStorage
                router.replace(`/student?sessionId=${storedSessionId}`, undefined, { shallow: true });
              }
            }
          }
        } else {
          router.push('/login');
        }
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
        router.push('/');
      });
  }, [router, sessionId, mounted]);

  // Reset hasAutoJoined when token changes (new QR scan)
  useEffect(() => {
    if (!mounted) return; // Don't run on server-side
    
    if (token) {
      console.log('[StudentPage] Token changed, resetting hasAutoJoined:', token);
      setHasAutoJoined(false);
    }
  }, [token, mounted]);

  // Separate effect for auto-join to avoid infinite loop
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!mounted) return; // Don't run on server-side
    
    // Check if this is a chain scan URL (has chainId and tokenId)
    const isChainScan = chainId && tokenId;
    
    // Only auto-join for teacher's entry/exit QR codes (has type parameter)
    // Don't auto-join when just restoring from localStorage (no type parameter)
    const hasQRType = type !== undefined;
    
    console.log('[StudentPage] Auto-join check:', {
      user: !!user,
      sessionId,
      hasQRType,
      hasAutoJoined,
      joining,
      isChainScan
    });
    
    if (user && sessionId && typeof sessionId === 'string' && hasQRType && !hasAutoJoined && !joining && !isChainScan) {
      console.log('[StudentPage] Triggering auto-join');
      setHasAutoJoined(true);
      const qrType = typeof type === 'string' ? type : undefined;
      const qrToken = typeof token === 'string' ? token : undefined;
      handleJoinSession(sessionId, qrType, qrToken);
    }
  }, [user, sessionId, type, token, chainId, tokenId, hasAutoJoined, joining, mounted]);

  const handleJoinSession = async (sessionIdToJoin: string, qrType?: string, qrToken?: string) => {
    if (!user) return;
    
    setJoining(true);
    setError(null);
    setLocationWarning(null);
    
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '/api';
      
      // Try to get location with detailed error
      const { location, error: locationError, errorCode } = await getCurrentLocationWithError();
      
      // Show location warning if location is not available
      if (!location && locationError) {
        setLocationWarning(locationError);
        
        // If permission denied, show a more prominent warning
        if (errorCode === 'PERMISSION_DENIED') {
          // Continue with join but warn user
          console.warn('Location permission denied, continuing without location');
        }
      }
      
      // Create headers with authentication
      const headers = await getAuthHeaders();
      
      // Handle ENTRY or EXIT based on QR type
      if (qrType === 'ENTRY') {
        // Mark entry with token validation
        const response = await fetch(`${apiUrl}/sessions/${sessionIdToJoin}/join`, { credentials: 'include',
          method: 'POST',
          headers,
          body: JSON.stringify({ 
            token: qrToken,
            location // Include location if available
          })
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error?.message || 'Failed to mark entry');
        }
        
        // Store session in localStorage for persistence across refreshes
        if (typeof window !== 'undefined') {
          localStorage.setItem('activeSessionId', sessionIdToJoin);
        }
        
        // Successfully joined - navigate to session view (without token in URL)
        router.push(`/student?sessionId=${sessionIdToJoin}`);
        
      } else if (qrType === 'EXIT') {
        // Mark exit with token validation
        const response = await fetch(`${apiUrl}/sessions/${sessionIdToJoin}/exit`, { credentials: 'include',
          method: 'POST',
          headers,
          body: JSON.stringify({ 
            token: qrToken,
            location // Include location if available
          })
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error?.message || 'Failed to mark exit');
        }
        
        // Clear session from localStorage when exiting
        if (typeof window !== 'undefined') {
          localStorage.removeItem('activeSessionId');
        }
        
        // Successfully marked exit - show success message and redirect
        alert('Exit marked successfully! You can now leave.');
        router.push('/student');
        
      } else {
        // No type specified - just join the session (backward compatibility)
        const response = await fetch(`${apiUrl}/sessions/${sessionIdToJoin}/join`, { credentials: 'include',
          method: 'POST',
          headers,
          body: JSON.stringify({ location }) // Include location if available
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error?.message || 'Failed to join session');
        }
        
        // Store session in localStorage for persistence across refreshes
        if (typeof window !== 'undefined') {
          localStorage.setItem('activeSessionId', sessionIdToJoin);
        }
        
        // Successfully joined - navigate to session view
        router.push(`/student?sessionId=${sessionIdToJoin}`);
      }
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to process request';
      setError(errorMessage);
      setHasAutoJoined(false); // Allow retry
      
      // Clear URL parameters so user sees the error page
      router.replace('/student', undefined, { shallow: true });
    } finally {
      setJoining(false);
    }
  };

  const handleInAppScan = (result: any, scanError: any) => {
    if (scanError?.name === 'NotAllowedError') {
      setScannerError('Camera access denied. Please allow camera permission and try again.');
      return;
    }

    const scannedText = extractScannedText(result);
    if (!scannedText) {
      return;
    }

    if (scannedText === lastScannedText) {
      return;
    }

    setLastScannedText(scannedText);

    const payload = parseStudentQRPayload(scannedText);
    if (!payload) {
      setScannerError('Invalid QR code. Please scan the student session QR code from your teacher.');
      return;
    }

    setScannerError(null);
    setScannerEnabled(false);

    const params = new URLSearchParams({ sessionId: payload.sessionId });
    if (payload.type) {
      params.set('type', payload.type);
    }
    if (payload.token) {
      params.set('token', payload.token);
    }

    router.push(`/student?${params.toString()}`);
  };

  if (loading) {
    return (
      <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
        <p>Loading...</p>
      </div>
    );
  }

  if (!user || !user.userRoles.includes('student')) {
    return null;
  }

  // Show loading state when joining
  if (joining) {
    return (
      <div style={{ 
        padding: '2rem', 
        fontFamily: 'system-ui, sans-serif',
        maxWidth: '600px',
        margin: '0 auto',
        textAlign: 'center'
      }}>
        <div style={{ 
          fontSize: '4rem', 
          marginBottom: '1rem',
          animation: 'pulse 1.5s ease-in-out infinite'
        }}>
          ⏳
        </div>
        <h2 style={{ margin: '0 0 0.5rem 0' }}>Joining Session...</h2>
        <p style={{ color: '#666' }}>Please wait while we verify your entry.</p>
      </div>
    );
  }

  // If sessionId in query and already joined, show session view
  // BUT: Don't show if there's an error (failed to join)
  // ALSO: Pass through chain scan URLs (has chainId/tokenId) to SimpleStudentView
  if (sessionId && typeof sessionId === 'string' && !error && (!type || chainId)) {
    return (
      <SimpleStudentView 
        sessionId={sessionId}
        studentId={user.userDetails}
        onLeaveSession={() => {
          // Clear stored session when leaving
          if (typeof window !== 'undefined') {
            localStorage.removeItem('activeSessionId');
          }
          router.push('/student');
        }}
      />
    );
  }

  // Show join interface - simplified to just manual entry
  return (
    <div style={{ 
      padding: '2rem', 
      fontFamily: 'system-ui, sans-serif',
      maxWidth: '600px',
      margin: '0 auto'
    }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: '0 0 0.5rem 0' }}>Student View</h1>
        <p style={{ margin: 0, color: '#666' }}>Welcome, {user.userDetails}</p>
      </div>

      {locationWarning && (
        <div style={{
          padding: '1.5rem',
          backgroundColor: '#fff5e6',
          border: '2px solid #ff9800',
          borderRadius: '8px',
          marginBottom: '1.5rem',
          color: '#e65100'
        }}>
          <div style={{ 
            fontSize: '2rem', 
            marginBottom: '0.5rem',
            textAlign: 'center'
          }}>
            📍
          </div>
          <div style={{ 
            fontSize: '1.1rem', 
            fontWeight: 'bold',
            marginBottom: '0.5rem',
            textAlign: 'center'
          }}>
            Location Access Required
          </div>
          <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
            {locationWarning}
          </div>
          <div style={{
            padding: '1rem',
            backgroundColor: '#fff',
            border: '1px solid #ff9800',
            borderRadius: '4px',
            fontSize: '0.9rem',
            lineHeight: '1.6'
          }}>
            <strong>How to enable location:</strong>
            <ol style={{ margin: '0.5rem 0 0 0', paddingLeft: '1.5rem' }}>
              <li>Click the location icon in your browser's address bar</li>
              <li>Select "Allow" or "Always allow"</li>
              <li>Refresh this page and try again</li>
            </ol>
          </div>
          <button
            onClick={() => setLocationWarning(null)}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1rem',
              backgroundColor: '#ff9800',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              width: '100%',
              fontSize: '0.95rem',
              fontWeight: '600'
            }}
          >
            I Understand
          </button>
        </div>
      )}

      {error && (
        <div style={{
          padding: '1.5rem',
          backgroundColor: '#fef0f0',
          border: '2px solid #d13438',
          borderRadius: '8px',
          marginBottom: '1.5rem',
          color: '#d13438'
        }}>
          <div style={{ 
            fontSize: '2rem', 
            marginBottom: '0.5rem',
            textAlign: 'center'
          }}>
            ❌
          </div>
          <div style={{ 
            fontSize: '1.1rem', 
            fontWeight: 'bold',
            marginBottom: '0.5rem',
            textAlign: 'center'
          }}>
            Failed to Join Session
          </div>
          <div style={{ textAlign: 'center' }}>
            {error}
          </div>
          {error.includes('expired') && (
            <div style={{
              marginTop: '1rem',
              padding: '1rem',
              backgroundColor: '#fff5e6',
              border: '1px solid #ff9800',
              borderRadius: '4px',
              color: '#e65100',
              fontSize: '0.9rem'
            }}>
              <strong>💡 Tip:</strong> QR codes expire after 20 seconds. Ask your teacher to show the QR code again.
            </div>
          )}
          <button
            onClick={() => setError(null)}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1rem',
              backgroundColor: '#d13438',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              width: '100%',
              fontSize: '0.95rem',
              fontWeight: '600'
            }}
          >
            Try Again
          </button>
        </div>
      )}

      <div style={{
        padding: '2rem',
        backgroundColor: '#f5f5f5',
        borderRadius: '8px',
        marginBottom: '2rem'
      }}>
        <h2 style={{ marginTop: 0 }}>Join a Session</h2>
        
        <div style={{
          textAlign: 'center',
          padding: '3rem 1rem'
        }}>
          <div style={{
            fontSize: '4rem',
            marginBottom: '1rem'
          }}>
            📱
          </div>
          <h3 style={{ margin: '0 0 1rem 0', color: '#333' }}>
            Scan QR Code to Join
          </h3>
          <p style={{ color: '#666', lineHeight: '1.6', maxWidth: '400px', margin: '0 auto' }}>
            Use your phone camera to scan the session QR code displayed by your teacher.
          </p>
          <p style={{ color: '#666', lineHeight: '1.6', maxWidth: '400px', margin: '1rem auto 0' }}>
            The QR code will automatically redirect you to the session.
          </p>

          <button
            onClick={() => {
              setScannerError(null);
              setScannerEnabled((prev) => !prev);
            }}
            style={{
              marginTop: '1.5rem',
              padding: '0.75rem 1.25rem',
              backgroundColor: scannerEnabled ? '#718096' : '#2b6cb0',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '0.95rem',
              fontWeight: 600
            }}
          >
            {scannerEnabled ? 'Stop In-App Scanner' : 'Scan QR in This Page (iOS Recommended)'}
          </button>

          {scannerEnabled && (
            <div style={{ marginTop: '1.5rem' }}>
              <div style={{
                width: '100%',
                maxWidth: '420px',
                margin: '0 auto',
                borderRadius: '8px',
                overflow: 'hidden',
                backgroundColor: '#000'
              }}>
                <QrReader
                  onResult={handleInAppScan}
                  constraints={{ facingMode: 'environment' }}
                  scanDelay={400}
                  containerStyle={{ width: '100%' }}
                  videoStyle={{ width: '100%', height: 'auto' }}
                />
              </div>
              {scannerError && (
                <p style={{
                  marginTop: '0.75rem',
                  color: '#c53030',
                  textAlign: 'center',
                  fontSize: '0.9rem'
                }}>
                  {scannerError}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <button 
        onClick={() => router.push('/')}
        style={{
          padding: '0.5rem 1rem',
          backgroundColor: '#666',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '0.875rem'
        }}
      >
        Back to Home
      </button>
    </div>
  );
}






