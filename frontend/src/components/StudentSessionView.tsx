/**
 * Student Session View Component
 * Feature: qr-chain-attendance
 * Requirements: 13.1, 13.2, 13.3, 13.5
 * 
 * Main student interface for participating in attendance verification:
 * - Display session information
 * - Show holder status and QR when applicable
 * - Provide scan button for peer QR codes
 * - Handle late entry and early leave flows
 */

import { useState, useEffect, useCallback } from 'react';
import { getAuthHeaders } from '../utils/authHeaders';
import { QRScanner } from './QRScanner';
import { QRDisplay } from './QRDisplay';
import { StudentCaptureUI } from './StudentCaptureUI';
import * as signalR from '@microsoft/signalr';
import { getCurrentLocation } from '../utils/geolocation';
import type {
  Session,
  ChainQRData,
  RotatingQRData,
  ChainScanResponse,
  SessionQRData,
} from '../types/shared';

export interface StudentSessionViewProps {
  /**
   * Session ID to display
   */
  sessionId: string;

  /**
   * Student ID (from authentication)
   */
  studentId: string;

  /**
   * Callback when student leaves the session
   */
  onLeaveSession?: () => void;

  /**
   * Custom styling
   */
  className?: string;
}

/**
 * Student status in the session
 */
interface StudentStatus {
  isHolder: boolean;
  holderToken?: ChainQRData;
  entryStatus?: 'PRESENT_ENTRY' | 'LATE_ENTRY';
  exitVerified: boolean;
  earlyLeaveMarked: boolean;
}

/**
 * Format ISO 8601 date to readable time
 */
function formatTime(isoString: string | undefined): string {
  if (!isoString) return 'Not set';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return 'Invalid Date';
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return 'Invalid Date';
  }
}

/**
 * Calculate if late cutoff has passed
 */
function isAfterLateCutoff(session: Session): boolean {
  const startTime = new Date(session.startAt).getTime();
  const cutoffTime = startTime + session.lateCutoffMinutes * 60 * 1000;
  return Date.now() > cutoffTime;
}

/**
 * Calculate if session has started
 */
function hasSessionStarted(session: Session): boolean {
  return Date.now() >= new Date(session.startAt).getTime();
}

/**
 * Calculate if session has ended
 */
function hasSessionEnded(session: Session): boolean {
  return Date.now() >= new Date(session.endAt).getTime();
}

/**
 * Student Session View Component
 */
export function StudentSessionView({
  sessionId,
  studentId,
  onLeaveSession,
  className = '',
}: StudentSessionViewProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [studentStatus, setStudentStatus] = useState<StudentStatus>({
    isHolder: false,
    exitVerified: false,
    earlyLeaveMarked: false,
  });
  const [isScanning, setIsScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);
  const [locationWarning, setLocationWarning] = useState<string | null>(null);
  const [isEnablingLocation, setIsEnablingLocation] = useState(false);
  
  // Capture request state
  const [captureRequestId, setCaptureRequestId] = useState<string | null>(null);
  const [captureSasUrl, setCaptureSasUrl] = useState<string | null>(null);
  const [captureExpiresAt, setCaptureExpiresAt] = useState<number | null>(null);

  /**
   * Fetch session data
   */
  const fetchSession = useCallback(async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '/api';
      
      // Create headers with authentication
      const headers = await getAuthHeaders();
      
      const response = await fetch(`${apiUrl}/sessions/${sessionId}`, { credentials: 'include',
        headers
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch session');
      }
      const data = await response.json();
      setSession(data.session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load session');
    }
  }, [sessionId]);

  /**
   * Fetch student status (attendance and holder status)
   */
  const fetchStudentStatus = useCallback(async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '/api';
      
      // Create headers with authentication
      const headers = await getAuthHeaders();
      
      // Fetch attendance status
      const attendanceResponse = await fetch(`${apiUrl}/sessions/${sessionId}/attendance`, { credentials: 'include',
        headers
      });
      
      if (attendanceResponse.ok) {
        const attendanceData = await attendanceResponse.json();
        const myAttendance = attendanceData.attendance.find(
          (a: any) => a.studentId === studentId
        );

        if (myAttendance) {
          setStudentStatus((prev) => ({
            ...prev,
            entryStatus: myAttendance.entryStatus,
            exitVerified: myAttendance.exitVerified || false,
            earlyLeaveMarked: !!myAttendance.earlyLeaveAt,
          }));
          if (myAttendance.locationWarning) {
            setLocationWarning(myAttendance.locationWarning);
          }
        }
      }

      // Check if student is a holder (would need a dedicated endpoint in real implementation)
      // For now, we'll rely on scan responses to update holder status
    } catch (err) {
      console.error('Failed to fetch student status:', err);
    }
  }, [sessionId, studentId]);

  const handleEnableLocation = useCallback(async () => {
    setIsEnablingLocation(true);
    setError(null);

    try {
      const location = await getCurrentLocation();
      if (!location) {
        setError('Location permission is still disabled. Please enable it in browser settings.');
        return;
      }

      const response = await fetch(`/api/sessions/${sessionId}/join`, { credentials: 'include',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ location }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to update location');
      }

      const data = await response.json();
      if (data.locationWarning) {
        setLocationWarning(data.locationWarning);
      } else {
        setLocationWarning(null);
      }
      setSuccessMessage('Location enabled successfully.');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update location';
      setError(errorMessage);
      setTimeout(() => setError(null), 5000);
    } finally {
      setIsEnablingLocation(false);
    }
  }, [sessionId]);

  /**
   * Initial load
   */
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([fetchSession(), fetchStudentStatus()]);
      setLoading(false);
    };

    loadData();
  }, [fetchSession, fetchStudentStatus]);

  /**
   * Poll for updates every 10 seconds
   */
  useEffect(() => {
    const interval = setInterval(() => {
      fetchSession();
      fetchStudentStatus();
    }, 10000);

    setPollingInterval(interval);

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [fetchSession, fetchStudentStatus]);

  /**
   * Setup SignalR connection for capture requests
   */
  useEffect(() => {
    let connection: signalR.HubConnection | null = null;

    const setupSignalR = async () => {
      try {
        console.log('[SignalR] Starting setup for session:', sessionId);
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || '/api';
        const headers = await getAuthHeaders();
        
        console.log('[SignalR] Negotiating connection...');
        // Negotiate connection
        const negotiateResponse = await fetch(`${apiUrl}/sessions/${sessionId}/student/negotiate`, {
          credentials: 'include',
          method: 'POST',
          headers
        });

        if (!negotiateResponse.ok) {
          const errorText = await negotiateResponse.text();
          console.error('[SignalR] Failed to negotiate:', negotiateResponse.status, errorText);
          return;
        }

        const connectionInfo = await negotiateResponse.json();
        console.log('[SignalR] Connection info received:', {
          url: connectionInfo.url,
          hasAccessToken: !!connectionInfo.accessToken
        });

        // Create connection
        connection = new signalR.HubConnectionBuilder()
          .withUrl(connectionInfo.url, {
            accessTokenFactory: () => connectionInfo.accessToken,
          })
          .withAutomaticReconnect()
          .configureLogging(signalR.LogLevel.Information)
          .build();

        // Handle capture request event
        connection.on('captureRequest', (event: any) => {
          console.log('[SignalR] Capture request received:', event);
          console.log('[SignalR] Setting capture state:', {
            captureRequestId: event.captureRequestId,
            sasUrl: event.sasUrl,
            expiresAt: event.expiresAt
          });
          setCaptureRequestId(event.captureRequestId);
          setCaptureSasUrl(event.sasUrl);
          setCaptureExpiresAt(event.expiresAt);
        });

        connection.onreconnecting((error) => {
          console.warn('[SignalR] Reconnecting...', error);
        });

        connection.onreconnected((connectionId) => {
          console.log('[SignalR] Reconnected:', connectionId);
        });

        connection.onclose((error) => {
          console.log('[SignalR] Connection closed:', error);
        });

        await connection.start();
        console.log('[SignalR] Connected successfully for capture events');
      } catch (error) {
        console.error('[SignalR] Connection error:', error);
      }
    };

    setupSignalR();

    return () => {
      if (connection) {
        console.log('[SignalR] Stopping connection');
        connection.stop();
      }
    };
  }, [sessionId]);

  /**
   * Handle session QR scan (enrollment)
   */
  const handleSessionScanned = useCallback(
    async (sessionQRData: SessionQRData) => {
      setIsScanning(false);
        const location = await getCurrentLocation();

      
      try {
        // Call join session API
        const response = await fetch(`/api/sessions/${sessionQRData.sessionId}/join`, { credentials: 'include',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
                  body: JSON.stringify({ location }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error?.message || 'Failed to join session');
        }

        const data = await response.json();
        
        // Show success message
        setSuccessMessage(data.message || 'Successfully joined session!');
        if (data.locationWarning) {
          setSuccessMessage(`${data.message || 'Successfully joined session!'} (Location warning)`);
        }
        
        // Refresh session data
        await fetchSession();
        await fetchStudentStatus();
        
        // Clear success message after 5 seconds
        setTimeout(() => setSuccessMessage(null), 5000);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to join session';
        setError(errorMessage);
        
        // Clear error after 5 seconds
        setTimeout(() => setError(null), 5000);
      }
    },
    [fetchSession, fetchStudentStatus]
  );

  /**
   * Handle successful scan
   */
  const handleScanSuccess = useCallback(
    (result: ChainScanResponse) => {
      setIsScanning(false);

      if (result.success) {
        // Update student status based on scan result
        if (result.holderMarked) {
          const warningSuffix = result.locationWarning ? ' (Location warning)' : '';
          setSuccessMessage(`Scan successful! Attendance marked.${warningSuffix}`);
        }

        if (result.newHolder === studentId && result.newToken && result.newTokenEtag) {
          // Student became the new holder
          const tokenData: ChainQRData = JSON.parse(atob(result.newToken));
          setStudentStatus((prev) => ({
            ...prev,
            isHolder: true,
            holderToken: tokenData,
          }));
          const warningSuffix = result.locationWarning ? ' (Location warning)' : '';
          setSuccessMessage(`You are now the holder! Show your QR code to another student.${warningSuffix}`);
        } else {
          setStudentStatus((prev) => ({
            ...prev,
            isHolder: false,
            holderToken: undefined,
          }));
        }

        // Refresh status
        fetchStudentStatus();

        // Clear success message after 5 seconds
        setTimeout(() => setSuccessMessage(null), 5000);
      }
    },
    [studentId, fetchStudentStatus]
  );

  /**
   * Handle scan error
   */
  const handleScanError = useCallback((errorMessage: string) => {
    setIsScanning(false);
    setError(errorMessage);

    // Clear error after 5 seconds
    setTimeout(() => setError(null), 5000);
  }, []);

  /**
   * Handle token expiration
   */
  const handleTokenExpire = useCallback(() => {
    setStudentStatus((prev) => ({
      ...prev,
      isHolder: false,
      holderToken: undefined,
    }));
  }, []);

  /**
   * Toggle scanning mode
   */
  const toggleScanning = useCallback(() => {
    setIsScanning((prev) => !prev);
    setError(null);
    setSuccessMessage(null);
  }, []);

  if (loading) {
    return (
      <div className={`student-session-view ${className}`}>
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Loading session...</p>
        </div>
        <style jsx>{`
          .student-session-view {
            width: 100%;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 1rem;
            background: #f5f5f5;
          }

          .loading-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 3rem;
          }

          .spinner {
            width: 50px;
            height: 50px;
            border: 4px solid rgba(0, 120, 212, 0.3);
            border-top-color: #0078d4;
            border-radius: 50%;
            animation: spin 1s linear infinite;
          }

          @keyframes spin {
            to {
              transform: rotate(360deg);
            }
          }

          .loading-container p {
            margin-top: 1rem;
            color: #666;
            font-size: 1rem;
          }
        `}</style>
      </div>
    );
  }

  if (!session) {
    return (
      <div className={`student-session-view ${className}`}>
        <div className="error-container">
          <p>Session not found</p>
          {onLeaveSession && (
            <button onClick={onLeaveSession} className="button-secondary">
              Back
            </button>
          )}
        </div>
        <style jsx>{`
          .student-session-view {
            width: 100%;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 1rem;
            background: #f5f5f5;
          }

          .error-container {
            padding: 2rem;
            text-align: center;
          }

          .error-container p {
            color: #d32f2f;
            font-size: 1.1rem;
            margin-bottom: 1rem;
          }

          .button-secondary {
            padding: 0.75rem 1.5rem;
            background: #666;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 1rem;
            font-weight: 500;
          }

          .button-secondary:hover {
            background: #555;
          }
        `}</style>
      </div>
    );
  }

  const sessionStarted = hasSessionStarted(session);
  const sessionEnded = hasSessionEnded(session);
  const afterLateCutoff = isAfterLateCutoff(session);

  return (
    <div className={`student-session-view ${className}`}>
      {/* Header */}
      <div className="header">
        <div className="header-content">
          <h1>Class Session</h1>
          <p className="class-id">{session.classId}</p>
          {onLeaveSession && (
            <button onClick={onLeaveSession} className="leave-button">
              Leave Session
            </button>
          )}
        </div>
      </div>

      {/* Session Info */}
      <div className="session-info-card">
        <div className="info-row">
          <span className="info-label">Start Time:</span>
          <span className="info-value">{formatTime(session.startAt)}</span>
        </div>
        <div className="info-row">
          <span className="info-label">End Time:</span>
          <span className="info-value">{formatTime(session.endAt)}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Status:</span>
          <span className={`status-badge ${session.status.toLowerCase()}`}>
            {session.status}
          </span>
        </div>
      </div>

      {/* Session Status Messages */}
      {!sessionStarted && (
        <div className="status-message info">
          <p>⏰ Session has not started yet. Please wait until {formatTime(session.startAt)}.</p>
        </div>
      )}

      {sessionEnded && (
        <div className="status-message info">
          <p>✅ Session has ended. Thank you for attending!</p>
        </div>
      )}

      {/* Student Status */}
      {studentStatus.entryStatus && (
        <div className="student-status-card">
          <h2>Your Status</h2>
          <div className="status-grid">
            <div className="status-item">
              <span className="status-label">Entry:</span>
              <span className={`status-badge ${studentStatus.entryStatus.toLowerCase()}`}>
                {studentStatus.entryStatus === 'PRESENT_ENTRY' ? 'Present' : 'Late'}
              </span>
            </div>
            {studentStatus.exitVerified && (
              <div className="status-item">
                <span className="status-label">Exit:</span>
                <span className="status-badge verified">Verified</span>
              </div>
            )}
            {studentStatus.earlyLeaveMarked && (
              <div className="status-item">
                <span className="status-label">Early Leave:</span>
                <span className="status-badge early-leave">Marked</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Student Image Capture UI */}
      {/* Debug info - remove after testing */}
      {process.env.NODE_ENV === 'development' && (
        <div style={{ padding: '1rem', background: '#f0f0f0', margin: '1rem', fontSize: '0.8rem' }}>
          <strong>Debug Info:</strong>
          <div>sessionStarted: {sessionStarted ? 'true' : 'false'}</div>
          <div>sessionEnded: {sessionEnded ? 'true' : 'false'}</div>
          <div>captureRequestId: {captureRequestId || 'null'}</div>
          <div>captureSasUrl: {captureSasUrl ? 'set' : 'null'}</div>
          <div>captureExpiresAt: {captureExpiresAt || 'null'}</div>
          <div>Should show UI: {(sessionStarted && !sessionEnded && captureRequestId && captureSasUrl && captureExpiresAt) ? 'YES' : 'NO'}</div>
        </div>
      )}
      
      {sessionStarted && !sessionEnded && captureRequestId && captureSasUrl && captureExpiresAt && (
        <StudentCaptureUI
          sessionId={sessionId}
          studentId={studentId}
          captureRequestId={captureRequestId}
          sasUrl={captureSasUrl}
          expiresAt={captureExpiresAt}
          onUploadComplete={() => {
            // Clear capture request after upload
            setCaptureRequestId(null);
            setCaptureSasUrl(null);
            setCaptureExpiresAt(null);
            setSuccessMessage('Photo uploaded successfully!');
            setTimeout(() => setSuccessMessage(null), 5000);
          }}
          onCaptureExpired={() => {
            // Clear capture request when expired
            setCaptureRequestId(null);
            setCaptureSasUrl(null);
            setCaptureExpiresAt(null);
          }}
        />
      )}

      {/* Messages */}
      {successMessage && (
        <div className="status-message success">
          <p>✓ {successMessage}</p>
        </div>
      )}

      {error && (
        <div className="status-message error">
          <p>✗ {error}</p>
        </div>
      )}

      {/* Holder QR Display */}
      {studentStatus.isHolder && studentStatus.holderToken && (
        <div className="holder-section">
          <h2>You are the Holder!</h2>
          <p className="holder-instruction">
            Show this QR code to another student to pass the token
          </p>
          <QRDisplay
            qrData={studentStatus.holderToken}
            onExpire={handleTokenExpire}
            showHolderInfo={true}
          />
        </div>
      )}

      {/* Scan Section */}
      {sessionStarted && !sessionEnded && (
        <div className="scan-section">
          {!isScanning ? (
            <div className="scan-controls">
              <h2>Scan QR Code</h2>
              <p className="scan-instruction">
                {!studentStatus.entryStatus
                  ? 'Scan a peer\'s QR code to mark your entry'
                  : afterLateCutoff && session.lateEntryActive
                  ? 'Scan the teacher\'s late entry QR code'
                  : session.earlyLeaveActive
                  ? 'Scan the teacher\'s early leave QR code if you need to leave early'
                  : 'Scan a peer\'s QR code or wait for exit chain'}
              </p>
              <button onClick={toggleScanning} className="button-primary scan-button">
                📷 Open Scanner
              </button>
            </div>
          ) : (
            <div className="scanner-container">
              <div className="scanner-header">
                <h2>Scanning...</h2>
                <button onClick={toggleScanning} className="button-secondary close-button">
                  Close Scanner
                </button>
              </div>
              <QRScanner
                isActive={isScanning}
                sessionId={sessionId}
                onSessionScanned={handleSessionScanned}
                onScanSuccess={handleScanSuccess}
                onScanError={handleScanError}
              />
            </div>
          )}
        </div>
      )}

      {/* Instructions */}
      {sessionStarted && !sessionEnded && !studentStatus.entryStatus && (
        <div className="instructions-card">
          <h3>How to Mark Attendance</h3>
          <ol>
            <li>Wait for the teacher to start the entry chain</li>
            <li>When a peer becomes a holder, scan their QR code</li>
            <li>If you become the holder, show your QR code to another student</li>
          </ol>
        </div>
      )}

      <style jsx>{`
        .student-session-view {
          width: 100%;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding-bottom: 2rem;
          background: #f5f5f5;
        }

        .header {
          width: 100%;
          background: linear-gradient(135deg, #0078d4 0%, #005a9e 100%);
          color: white;
          padding: 1.5rem;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }

        .header-content {
          max-width: 800px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .header h1 {
          margin: 0;
          font-size: 1.75rem;
          font-weight: 600;
        }

        .class-id {
          font-size: 1rem;
          opacity: 0.9;
        }

        .leave-button {
          align-self: flex-start;
          margin-top: 0.5rem;
          padding: 0.5rem 1rem;
          background: rgba(255, 255, 255, 0.2);
          color: white;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 6px;
          cursor: pointer;
          font-size: 0.9rem;
          transition: background 0.2s;
        }

        .leave-button:hover {
          background: rgba(255, 255, 255, 0.3);
        }

        .session-info-card,
        .student-status-card,
        .holder-section,
        .scan-section,
        .instructions-card {
          width: 100%;
          max-width: 800px;
          background: white;
          border-radius: 12px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          padding: 1.5rem;
          margin-top: 1rem;
        }

        .session-info-card {
          margin-top: 1.5rem;
        }

        .info-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.75rem 0;
          border-bottom: 1px solid #e0e0e0;
        }

        .info-row:last-child {
          border-bottom: none;
        }

        .info-label {
          font-weight: 500;
          color: #666;
        }

        .info-value {
          font-weight: 600;
          color: #333;
        }

        .status-badge {
          padding: 0.25rem 0.75rem;
          border-radius: 12px;
          font-size: 0.85rem;
          font-weight: 600;
          text-transform: uppercase;
        }

        .status-badge.active {
          background: #e8f5e9;
          color: #2e7d32;
        }

        .status-badge.ended {
          background: #e0e0e0;
          color: #666;
        }

        .status-badge.present_entry {
          background: #e8f5e9;
          color: #2e7d32;
        }

        .status-badge.late_entry {
          background: #fff3e0;
          color: #e65100;
        }

        .status-badge.verified {
          background: #e3f2fd;
          color: #1565c0;
        }

        .status-badge.early-leave {
          background: #ffebee;
          color: #c62828;
        }

        .student-status-card h2,
        .holder-section h2,
        .scan-section h2 {
          margin: 0 0 1rem 0;
          font-size: 1.25rem;
          font-weight: 600;
          color: #333;
        }

        .status-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 1rem;
        }

        .status-item {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .status-label {
          font-size: 0.9rem;
          color: #666;
          font-weight: 500;
        }

        .status-message {
          width: 100%;
          max-width: 800px;
          padding: 1rem 1.5rem;
          border-radius: 8px;
          margin-top: 1rem;
        }

        .status-message.info {
          background: #e3f2fd;
          border-left: 4px solid #1976d2;
          color: #0d47a1;
        }

        .status-message.success {
          background: #e8f5e9;
          border-left: 4px solid #4caf50;
          color: #1b5e20;
        }

        .status-message.error {
          background: #ffebee;
          border-left: 4px solid #f44336;
          color: #b71c1c;
        }

        .status-message.warning {
          background: #fff8e1;
          border-left: 4px solid #f6ad55;
          color: #8a6d1d;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
        }

        .status-message p {
          margin: 0;
          font-weight: 500;
        }

        .holder-instruction {
          text-align: center;
          color: #666;
          margin-bottom: 1rem;
        }

        .scan-controls {
          text-align: center;
        }

        .scan-instruction {
          color: #666;
          margin-bottom: 1.5rem;
          line-height: 1.5;
        }

        .button-primary {
          padding: 1rem 2rem;
          background: #0078d4;
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 1.1rem;
          font-weight: 600;
          transition: background 0.2s;
          box-shadow: 0 2px 8px rgba(0, 120, 212, 0.3);
        }

        .button-primary:hover {
          background: #005a9e;
        }

        .button-primary:active {
          transform: translateY(1px);
        }

        .scan-button {
          width: 100%;
          max-width: 300px;
        }

        .scanner-container {
          width: 100%;
        }

        .scanner-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
        }

        .scanner-header h2 {
          margin: 0;
        }

        .button-secondary {
          padding: 0.5rem 1rem;
          background: #666;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 0.9rem;
          font-weight: 500;
          transition: background 0.2s;
        }

        .button-secondary:hover {
          background: #555;
        }

        .close-button {
          padding: 0.75rem 1.5rem;
        }

        .instructions-card h3 {
          margin: 0 0 1rem 0;
          font-size: 1.1rem;
          font-weight: 600;
          color: #333;
        }

        .instructions-card ol {
          margin: 0;
          padding-left: 1.5rem;
          color: #666;
          line-height: 1.8;
        }

        .instructions-card li {
          margin-bottom: 0.5rem;
        }

        @media (max-width: 768px) {
          .header-content {
            padding: 0;
          }

          .header h1 {
            font-size: 1.5rem;
          }

          .session-info-card,
          .student-status-card,
          .holder-section,
          .scan-section,
          .instructions-card {
            margin-left: 1rem;
            margin-right: 1rem;
          }

          .status-grid {
            grid-template-columns: 1fr;
          }

          .scanner-header {
            flex-direction: column;
            align-items: flex-start;
            gap: 1rem;
          }
        }
      `}</style>
    </div>
  );
}

export default StudentSessionView;





