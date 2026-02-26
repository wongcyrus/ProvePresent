/**
 * Teacher Capture Control Component
 * 
 * Allows teachers to initiate photo capture requests during online sessions.
 * Displays real-time status, countdown timer, and upload progress.
 * 
 * Features:
 * - "Capture Student Photos" button (enabled when session active and students online)
 * - Status indicator (idle, capturing, analyzing, completed, failed)
 * - 30-second countdown timer
 * - Upload progress (X/Y students uploaded)
 * - Error handling (no online students, API failures)
 * 
 * Validates: Requirements 1.1, 5.3
 */

import { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { getAuthHeaders } from '../utils/authHeaders';
import { SeatingGridVisualization } from './SeatingGridVisualization';
import type { 
  InitiateCaptureResponse,
  UploadCompleteEvent,
  CaptureExpiredEvent,
  CaptureResultsEvent,
  SeatingPosition
} from '../../../backend/src/types/studentImageCapture';

interface TeacherCaptureControlProps {
  sessionId: string;
  sessionStatus: 'ACTIVE' | 'ENDED';
  onlineStudentCount: number;
  onError?: (error: string) => void;
}

export interface TeacherCaptureControlHandle {
  handleUploadComplete: (event: UploadCompleteEvent) => void;
  handleCaptureExpired: (event: CaptureExpiredEvent) => void;
  handleCaptureResults: (event: CaptureResultsEvent) => void;
}

export const TeacherCaptureControl = forwardRef<TeacherCaptureControlHandle, TeacherCaptureControlProps>(({
  sessionId,
  sessionStatus,
  onlineStudentCount,
  onError
}, ref) => {
  // State management
  const [status, setStatus] = useState<'idle' | 'capturing' | 'analyzing' | 'completed' | 'failed'>('idle');
  const [captureRequestId, setCaptureRequestId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SeatingPosition[] | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('grid');

  /**
   * Calculate time remaining from expiresAt timestamp
   */
  useEffect(() => {
    if (!expiresAt || status !== 'capturing') {
      setTimeRemaining(0);
      return;
    }

    const updateTimer = () => {
      const now = Date.now();
      const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000));
      setTimeRemaining(remaining);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [expiresAt, status]);

  /**
   * Initiate capture request
   * Requirements: 1.1
   */
  const initiateCapture = async () => {
    console.log('[Capture] Initiating capture request...');
    try {
      setError(null);
      setStatus('capturing');

      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '/api';
      const headers = await getAuthHeaders();
      const url = `${apiUrl}/sessions/${sessionId}/capture/initiate`;
      
      console.log('[Capture] Calling API:', url);
      console.log('[Capture] Headers:', headers);

      const response = await fetch(
        url,
        {
          method: 'POST',
          credentials: 'include',
          headers
        }
      );

      console.log('[Capture] Response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('[Capture] Error response:', errorData);
        throw new Error(errorData.error?.message || `Failed to initiate capture: ${response.statusText}`);
      }

      const data: InitiateCaptureResponse = await response.json();
      console.log('[Capture] Success response:', data);

      setCaptureRequestId(data.captureRequestId);
      setExpiresAt(data.expiresAt);
      setTotalCount(data.onlineStudentCount);
      setUploadedCount(0);
      setResults(null);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to initiate capture';
      console.error('[Capture] Error:', errorMessage, err);
      setError(errorMessage);
      setStatus('failed');
      if (onError) {
        onError(errorMessage);
      }
    }
  };

  /**
   * Handle upload complete event from SignalR
   * Requirements: 7.2
   */
  const handleUploadComplete = useCallback((event: UploadCompleteEvent) => {
    if (event.captureRequestId === captureRequestId) {
      setUploadedCount(event.uploadedCount);
      setTotalCount(event.totalCount);
    }
  }, [captureRequestId]);

  /**
   * Handle capture expired event from SignalR
   * Requirements: 5.3, 7.3
   */
  const handleCaptureExpired = useCallback((event: CaptureExpiredEvent) => {
    if (event.captureRequestId === captureRequestId) {
      setStatus('analyzing');
      setUploadedCount(event.uploadedCount);
      setTotalCount(event.totalCount);
    }
  }, [captureRequestId]);

  /**
   * Handle capture results event from SignalR
   * Requirements: 6.3, 7.3
   */
  const handleCaptureResults = useCallback((event: CaptureResultsEvent) => {
    if (event.captureRequestId === captureRequestId) {
      if (event.status === 'COMPLETED') {
        setStatus('completed');
        setResults(event.positions || null);
      } else {
        setStatus('failed');
        setError(event.errorMessage || 'Analysis failed');
      }
    }
  }, [captureRequestId]);

  // Expose handler methods to parent via ref
  useImperativeHandle(ref, () => ({
    handleUploadComplete,
    handleCaptureExpired,
    handleCaptureResults
  }), [handleUploadComplete, handleCaptureExpired, handleCaptureResults]);

  /**
   * Reset to idle state
   */
  const resetCapture = () => {
    setStatus('idle');
    setCaptureRequestId(null);
    setExpiresAt(null);
    setUploadedCount(0);
    setTotalCount(0);
    setTimeRemaining(0);
    setError(null);
    setResults(null);
  };

  // Determine if button should be enabled
  const isButtonEnabled = 
    sessionStatus === 'ACTIVE' && 
    onlineStudentCount > 0 && 
    status === 'idle';

  return (
    <div style={{
      backgroundColor: 'white',
      padding: '1.5rem',
      borderRadius: '12px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
      marginBottom: '2rem'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '1rem',
        paddingBottom: '1rem',
        borderBottom: '2px solid #e0e0e0'
      }}>
        <h3 style={{
          margin: 0,
          fontSize: '1.3rem',
          color: '#333',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}>
          📸 Student Photo Capture
        </h3>

        {/* Status Indicator */}
        <div style={{
          padding: '0.5rem 1rem',
          backgroundColor: 
            status === 'idle' ? '#e0e0e0' :
            status === 'capturing' ? '#4299e1' :
            status === 'analyzing' ? '#ed8936' :
            status === 'completed' ? '#48bb78' :
            '#e53e3e',
          color: 'white',
          borderRadius: '20px',
          fontWeight: 'bold',
          fontSize: '0.9rem',
          textTransform: 'uppercase'
        }}>
          {status === 'idle' && '⚪ Idle'}
          {status === 'capturing' && '🔵 Capturing'}
          {status === 'analyzing' && '🟠 Analyzing'}
          {status === 'completed' && '🟢 Completed'}
          {status === 'failed' && '🔴 Failed'}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div style={{
          padding: '1rem',
          backgroundColor: '#fff5f5',
          border: '2px solid #fc8181',
          borderRadius: '8px',
          marginBottom: '1rem',
          color: '#c53030',
          fontSize: '0.9rem'
        }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Idle State */}
      {status === 'idle' && (
        <div>
          <p style={{
            color: '#666',
            marginBottom: '1rem',
            fontSize: '0.95rem'
          }}>
            Request all online students to capture and upload photos of their classroom view.
            The system will analyze the images to estimate seating positions.
          </p>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            marginBottom: '1rem'
          }}>
            <div style={{
              padding: '0.75rem 1rem',
              backgroundColor: onlineStudentCount > 0 ? '#e6f7ff' : '#fff3cd',
              border: `2px solid ${onlineStudentCount > 0 ? '#4299e1' : '#ed8936'}`,
              borderRadius: '8px',
              fontSize: '0.9rem',
              fontWeight: '600',
              color: onlineStudentCount > 0 ? '#2c5282' : '#744210'
            }}>
              {onlineStudentCount > 0 
                ? `🟢 ${onlineStudentCount} student${onlineStudentCount !== 1 ? 's' : ''} online`
                : '⚠️ No students online'}
            </div>
          </div>

          <button
            onClick={initiateCapture}
            disabled={!isButtonEnabled}
            style={{
              padding: '0.875rem 1.5rem',
              backgroundColor: isButtonEnabled ? '#4299e1' : '#a0aec0',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '1rem',
              fontWeight: 'bold',
              cursor: isButtonEnabled ? 'pointer' : 'not-allowed',
              opacity: isButtonEnabled ? 1 : 0.6,
              transition: 'all 0.2s'
            }}
          >
            📸 Capture Student Photos
          </button>

          {!isButtonEnabled && sessionStatus === 'ACTIVE' && onlineStudentCount === 0 && (
            <p style={{
              marginTop: '0.75rem',
              fontSize: '0.85rem',
              color: '#718096',
              fontStyle: 'italic'
            }}>
              Waiting for students to join the session...
            </p>
          )}
        </div>
      )}

      {/* Capturing State */}
      {status === 'capturing' && (
        <div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1rem'
          }}>
            <div>
              <div style={{
                fontSize: '1.1rem',
                fontWeight: 'bold',
                color: '#333',
                marginBottom: '0.25rem'
              }}>
                Capturing photos...
              </div>
              <div style={{
                fontSize: '0.9rem',
                color: '#666'
              }}>
                Students have {timeRemaining} seconds to upload
              </div>
            </div>

            <div style={{
              padding: '0.75rem 1.25rem',
              backgroundColor: timeRemaining <= 5 ? '#e53e3e' : timeRemaining <= 10 ? '#ed8936' : '#4299e1',
              color: 'white',
              borderRadius: '50%',
              fontWeight: 'bold',
              fontSize: '1.5rem',
              minWidth: '70px',
              minHeight: '70px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              {timeRemaining}
            </div>
          </div>

          {/* Progress Bar */}
          <div style={{
            marginBottom: '1rem'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: '0.5rem',
              fontSize: '0.9rem',
              color: '#666'
            }}>
              <span>Upload Progress</span>
              <span style={{ fontWeight: 'bold', color: '#333' }}>
                {uploadedCount} / {totalCount} students
              </span>
            </div>
            <div style={{
              width: '100%',
              height: '24px',
              backgroundColor: '#e0e0e0',
              borderRadius: '12px',
              overflow: 'hidden'
            }}>
              <div style={{
                width: `${totalCount > 0 ? (uploadedCount / totalCount) * 100 : 0}%`,
                height: '100%',
                backgroundColor: '#4299e1',
                transition: 'width 0.3s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontSize: '0.75rem',
                fontWeight: 'bold'
              }}>
                {totalCount > 0 ? Math.round((uploadedCount / totalCount) * 100) : 0}%
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Analyzing State */}
      {status === 'analyzing' && (
        <div style={{
          textAlign: 'center',
          padding: '2rem 1rem'
        }}>
          <div style={{
            fontSize: '3rem',
            marginBottom: '1rem',
            animation: 'pulse 2s infinite'
          }}>
            🤖
          </div>
          <div style={{
            fontSize: '1.2rem',
            fontWeight: 'bold',
            color: '#333',
            marginBottom: '0.5rem'
          }}>
            Analyzing positions...
          </div>
          <div style={{
            fontSize: '0.9rem',
            color: '#666'
          }}>
            AI is analyzing {uploadedCount} photo{uploadedCount !== 1 ? 's' : ''} to estimate seating positions
          </div>
        </div>
      )}

      {/* Completed State */}
      {status === 'completed' && (
        <div>
          <div style={{
            padding: '1rem',
            backgroundColor: '#e6ffed',
            border: '2px solid #48bb78',
            borderRadius: '8px',
            marginBottom: '1rem',
            color: '#22543d'
          }}>
            <strong>✓ Analysis Complete!</strong> Processed {uploadedCount} photo{uploadedCount !== 1 ? 's' : ''}.
          </div>

          {results && results.length > 0 && (
            <div style={{
              marginBottom: '1rem'
            }}>
              {/* View Toggle */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1rem'
              }}>
                <h4 style={{
                  margin: 0,
                  fontSize: '1rem',
                  color: '#333'
                }}>
                  Estimated Seating Positions:
                </h4>
                <div style={{
                  display: 'flex',
                  gap: '0.5rem',
                  backgroundColor: '#e2e8f0',
                  padding: '0.25rem',
                  borderRadius: '6px'
                }}>
                  <button
                    onClick={() => setViewMode('grid')}
                    style={{
                      padding: '0.5rem 1rem',
                      backgroundColor: viewMode === 'grid' ? '#4299e1' : 'transparent',
                      color: viewMode === 'grid' ? 'white' : '#4a5568',
                      border: 'none',
                      borderRadius: '4px',
                      fontSize: '0.85rem',
                      fontWeight: '600',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    🔲 Grid
                  </button>
                  <button
                    onClick={() => setViewMode('list')}
                    style={{
                      padding: '0.5rem 1rem',
                      backgroundColor: viewMode === 'list' ? '#4299e1' : 'transparent',
                      color: viewMode === 'list' ? 'white' : '#4a5568',
                      border: 'none',
                      borderRadius: '4px',
                      fontSize: '0.85rem',
                      fontWeight: '600',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    📋 List
                  </button>
                </div>
              </div>

              {/* Grid View */}
              {viewMode === 'grid' && (
                <div style={{ marginBottom: '1rem' }}>
                  <SeatingGridVisualization positions={results} />
                </div>
              )}

              {/* List View */}
              {viewMode === 'list' && (
                <div style={{
                  maxHeight: '300px',
                  overflowY: 'auto',
                  border: '1px solid #e0e0e0',
                  borderRadius: '8px',
                  padding: '0.75rem'
                }}>
                  {results.map((position, index) => (
                    <div
                      key={index}
                      style={{
                        padding: '0.75rem',
                        backgroundColor: '#f7fafc',
                        borderRadius: '6px',
                        marginBottom: '0.5rem',
                        fontSize: '0.85rem'
                      }}
                    >
                      <div style={{
                        fontWeight: 'bold',
                        color: '#333',
                        marginBottom: '0.25rem'
                      }}>
                        {position.studentId.replace('@stu.vtc.edu.hk', '')}
                      </div>
                      <div style={{ color: '#666' }}>
                        Row {position.estimatedRow}, Column {position.estimatedColumn}
                        <span style={{
                          marginLeft: '0.5rem',
                          padding: '0.125rem 0.5rem',
                          backgroundColor: 
                            position.confidence === 'HIGH' ? '#c6f6d5' :
                            position.confidence === 'MEDIUM' ? '#fef3c7' :
                            '#fed7d7',
                          color:
                            position.confidence === 'HIGH' ? '#22543d' :
                            position.confidence === 'MEDIUM' ? '#744210' :
                            '#742a2a',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: '600'
                        }}>
                          {position.confidence}
                        </span>
                      </div>
                      {position.reasoning && (
                        <div style={{
                          marginTop: '0.25rem',
                          fontSize: '0.8rem',
                          color: '#718096',
                          fontStyle: 'italic'
                        }}>
                          {position.reasoning}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <button
            onClick={resetCapture}
            style={{
              padding: '0.75rem 1.25rem',
              backgroundColor: '#4299e1',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '0.95rem',
              fontWeight: 'bold',
              cursor: 'pointer'
            }}
          >
            Start New Capture
          </button>
        </div>
      )}

      {/* Failed State */}
      {status === 'failed' && (
        <div>
          <div style={{
            padding: '1rem',
            backgroundColor: '#fff5f5',
            border: '2px solid #fc8181',
            borderRadius: '8px',
            marginBottom: '1rem',
            color: '#c53030'
          }}>
            <strong>✗ Capture Failed</strong>
            {error && <div style={{ marginTop: '0.5rem' }}>{error}</div>}
          </div>

          <button
            onClick={resetCapture}
            style={{
              padding: '0.75rem 1.25rem',
              backgroundColor: '#4299e1',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '0.95rem',
              fontWeight: 'bold',
              cursor: 'pointer'
            }}
          >
            Try Again
          </button>
        </div>
      )}

      {/* CSS Animation */}
      <style jsx>{`
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
      `}</style>
    </div>
  );
});

TeacherCaptureControl.displayName = 'TeacherCaptureControl';

// Export event handlers for parent component to register with SignalR
export type { UploadCompleteEvent, CaptureExpiredEvent, CaptureResultsEvent };
