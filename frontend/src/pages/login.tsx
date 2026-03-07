/**
 * Login Page
 * Email OTP authentication flow
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { getAuthEndpoint } from '../utils/authHeaders';

type LoginStep = 'email' | 'otp';

export default function Login() {
  const router = useRouter();
  const [step, setStep] = useState<LoginStep>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | undefined>();

  // Countdown timer for OTP expiry
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  // Check if already authenticated
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const authEndpoint = getAuthEndpoint();
        const response = await fetch(authEndpoint, {
          credentials: 'include',
          cache: 'no-store'
        });
        
        const data = await response.json();
        if (data.clientPrincipal) {
          // Already authenticated, redirect to home
          router.push('/');
        }
      } catch (error) {
        // Not authenticated, stay on login page
      }
    };
    
    checkAuth();
  }, [router]);

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '/api';
      const response = await fetch(`${apiUrl}/auth/request-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email })
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 429) {
          const retryAfter = data.error?.retryAfter || 900;
          setError(`Too many requests. Please try again in ${Math.ceil(retryAfter / 60)} minutes.`);
        } else if (response.status === 403) {
          setError('This email domain is not authorized. Please use a VTC email address.');
        } else {
          setError(data.error?.message || 'Failed to send verification code');
        }
        return;
      }

      // Success - move to OTP step
      setStep('otp');
      setCountdown(data.expiresIn || 300); // 5 minutes default
      setOtp('');
    } catch (error) {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '/api';
      const response = await fetch(`${apiUrl}/auth/verify-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include', // Important for cookie
        body: JSON.stringify({ email, otp })
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          const attemptsLeft = data.error?.attemptsRemaining;
          setAttemptsRemaining(attemptsLeft);
          
          if (data.error?.code === 'OTP_EXPIRED') {
            setError('Verification code has expired. Please request a new one.');
            setStep('email');
          } else if (data.error?.code === 'MAX_ATTEMPTS_EXCEEDED') {
            setError('Too many failed attempts. Please request a new code.');
            setStep('email');
          } else {
            const attemptsMsg = attemptsLeft !== undefined 
              ? ` (${attemptsLeft} attempt${attemptsLeft !== 1 ? 's' : ''} remaining)`
              : '';
            setError(`Invalid verification code${attemptsMsg}`);
          }
        } else {
          setError(data.error?.message || 'Failed to verify code');
        }
        return;
      }

      // Success - redirect based on role
      const user = data.user;
      
      // Wait a moment for cookie to be set
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Redirect based on role
      if (user.userRoles.includes('teacher')) {
        await router.push('/teacher');
      } else if (user.userRoles.includes('student')) {
        await router.push('/student');
      } else {
        await router.push('/');
      }
    } catch (error) {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = () => {
    setStep('email');
    setOtp('');
    setError('');
    setAttemptsRemaining(undefined);
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <>
      <Head>
        <title>Login - ProvePresent</title>
      </Head>

      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f3f4f6',
        padding: '1rem'
      }}>
        <div style={{
          backgroundColor: 'white',
          padding: '2rem',
          borderRadius: '8px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          width: '100%',
          maxWidth: '400px'
        }}>
          <h1 style={{ 
            fontSize: '1.5rem', 
            fontWeight: 'bold', 
            marginBottom: '1.5rem',
            textAlign: 'center'
          }}>
            Sign In
          </h1>

          {error && (
            <div style={{
              backgroundColor: '#fee2e2',
              color: '#991b1b',
              padding: '0.75rem',
              borderRadius: '4px',
              marginBottom: '1rem',
              fontSize: '0.875rem'
            }}>
              {error}
            </div>
          )}

          {step === 'email' ? (
            <form onSubmit={handleRequestOtp}>
              <div style={{ marginBottom: '1rem' }}>
                <label htmlFor="email" style={{
                  display: 'block',
                  fontSize: '0.875rem',
                  fontWeight: '500',
                  marginBottom: '0.5rem'
                }}>
                  Email Address
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your.email@vtc.edu.hk"
                  required
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid #d1d5db',
                    borderRadius: '4px',
                    fontSize: '1rem'
                  }}
                />
              </div>

              <button
                type="submit"
                disabled={loading || !email}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  backgroundColor: loading || !email ? '#9ca3af' : '#2563eb',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '1rem',
                  fontWeight: '500',
                  cursor: loading || !email ? 'not-allowed' : 'pointer'
                }}
              >
                {loading ? 'Sending...' : 'Send Verification Code'}
              </button>

              <p style={{
                marginTop: '1rem',
                fontSize: '0.875rem',
                color: '#6b7280',
                textAlign: 'center'
              }}>
                Use your VTC email address to sign in
              </p>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp}>
              <div style={{ marginBottom: '1rem' }}>
                <p style={{
                  fontSize: '0.875rem',
                  color: '#6b7280',
                  marginBottom: '1rem'
                }}>
                  Enter the 6-digit code sent to:<br />
                  <strong>{email}</strong>
                </p>

                <label htmlFor="otp" style={{
                  display: 'block',
                  fontSize: '0.875rem',
                  fontWeight: '500',
                  marginBottom: '0.5rem'
                }}>
                  Verification Code
                </label>
                <input
                  id="otp"
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  required
                  disabled={loading}
                  maxLength={6}
                  pattern="\d{6}"
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid #d1d5db',
                    borderRadius: '4px',
                    fontSize: '1.5rem',
                    letterSpacing: '0.5rem',
                    textAlign: 'center'
                  }}
                />

                {countdown > 0 && (
                  <p style={{
                    marginTop: '0.5rem',
                    fontSize: '0.75rem',
                    color: '#6b7280',
                    textAlign: 'center'
                  }}>
                    Code expires in {formatTime(countdown)}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading || otp.length !== 6}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  backgroundColor: loading || otp.length !== 6 ? '#9ca3af' : '#2563eb',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '1rem',
                  fontWeight: '500',
                  cursor: loading || otp.length !== 6 ? 'not-allowed' : 'pointer',
                  marginBottom: '0.5rem'
                }}
              >
                {loading ? 'Verifying...' : 'Verify Code'}
              </button>

              <button
                type="button"
                onClick={handleResendOtp}
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  backgroundColor: 'transparent',
                  color: '#2563eb',
                  border: '1px solid #2563eb',
                  borderRadius: '4px',
                  fontSize: '0.875rem',
                  fontWeight: '500',
                  cursor: loading ? 'not-allowed' : 'pointer'
                }}
              >
                Use Different Email
              </button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
