/**
 * Capture History Component
 * 
 * Requirements: 8.4
 * 
 * Displays historical capture requests for a session.
 * Allows teachers to view past capture results and seating positions.
 * 
 * Features:
 * - List of past capture requests with timestamps
 * - View results for completed captures
 * - Display seating grid visualization
 * - Show capture status (completed, failed, analyzing)
 */

import React, { useState, useEffect } from 'react';
import { getAuthHeaders } from '../utils/authHeaders';
import { SeatingGridVisualization } from './SeatingGridVisualization';
import type { 
  GetCaptureResultsResponse,
  SeatingPosition 
} from '../../../backend/src/types/studentImageCapture';

interface CaptureHistoryProps {
  sessionId: string;
  onError?: (error: string) => void;
}

interface CaptureHistoryItem {
  captureRequestId: string;
  createdAt: string;
  status: 'ACTIVE' | 'EXPIRED' | 'ANALYZING' | 'COMPLETED' | 'FAILED';
  uploadedCount: number;
  totalCount: number;
}

export function CaptureHistory({ sessionId, onError }: CaptureHistoryProps) {
  const [captureHistory, setCaptureHistory] = useState<CaptureHistoryItem[]>([]);
  const [selectedCapture, setSelectedCapture] = useState<string | null>(null);
  const [captureResults, setCaptureResults] = useState<GetCaptureResultsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingResults, setLoadingResults] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch capture history for the session
  useEffect(() => {
    fetchCaptureHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const fetchCaptureHistory = async () => {
    setLoading(true);
    setError(null);

    try {
      const headers = await getAuthHeaders();
      
      const response = await fetch(
        `/api/sessions/${sessionId}/capture/history`,
        {
          method: 'GET',
          headers
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch capture history: ${response.status}`);
      }

      const data = await response.json();
      setCaptureHistory(data.captures || []);
    } catch (err: any) {
      const errorMsg = err.message || 'Failed to load capture history';
      setError(errorMsg);
      if (onError) {
        onError(errorMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchCaptureResults = async (captureRequestId: string) => {
    setLoadingResults(true);
    setError(null);

    try {
      const headers = await getAuthHeaders();
      
      const response = await fetch(
        `/api/sessions/${sessionId}/capture/${captureRequestId}/results`,
        {
          method: 'GET',
          headers
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch capture results: ${response.status}`);
      }

      const data: GetCaptureResultsResponse = await response.json();
      setCaptureResults(data);
      setSelectedCapture(captureRequestId);
    } catch (err: any) {
      const errorMsg = err.message || 'Failed to load capture results';
      setError(errorMsg);
      if (onError) {
        onError(errorMsg);
      }
    } finally {
      setLoadingResults(false);
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return '#48bb78';
      case 'FAILED':
        return '#f56565';
      case 'ANALYZING':
        return '#ed8936';
      case 'ACTIVE':
        return '#4299e1';
      default:
        return '#a0aec0';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return '✓';
      case 'FAILED':
        return '✗';
      case 'ANALYZING':
        return '⟳';
      case 'ACTIVE':
        return '●';
      default:
        return '○';
    }
  };

  if (loading) {
    return (
      <div style={{
        padding: '1.5rem',
        backgroundColor: 'white',
        borderRadius: '12px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
        textAlign: 'center'
      }}>
        <div style={{ color: '#718096' }}>Loading capture history...</div>
      </div>
    );
  }

  if (captureHistory.length === 0) {
    return (
      <div style={{
        padding: '1.5rem',
        backgroundColor: 'white',
        borderRadius: '12px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
        border: '2px solid #e2e8f0'
      }}>
        <h3 style={{
          margin: '0 0 1rem 0',
          color: '#2d3748',
          fontSize: '1.25rem',
          fontWeight: '700'
        }}>
          📸 Capture History
        </h3>
        <div style={{ color: '#718096', textAlign: 'center', padding: '2rem' }}>
          No capture requests yet for this session.
        </div>
      </div>
    );
  }

  return (
    <div style={{
      padding: '1.5rem',
      backgroundColor: 'white',
      borderRadius: '12px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
      border: '2px solid #e2e8f0'
    }}>
      <h3 style={{
        margin: '0 0 1rem 0',
        color: '#2d3748',
        fontSize: '1.25rem',
        fontWeight: '700'
      }}>
        📸 Capture History
      </h3>

      {error && (
        <div style={{
          padding: '0.75rem',
          backgroundColor: '#fff5f5',
          border: '1px solid #fc8181',
          borderRadius: '8px',
          color: '#c53030',
          marginBottom: '1rem'
        }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {captureHistory.map((capture) => (
          <div
            key={capture.captureRequestId}
            style={{
              padding: '1rem',
              backgroundColor: selectedCapture === capture.captureRequestId ? '#f7fafc' : 'white',
              border: `2px solid ${selectedCapture === capture.captureRequestId ? '#4299e1' : '#e2e8f0'}`,
              borderRadius: '8px',
              cursor: capture.status === 'COMPLETED' ? 'pointer' : 'default',
              transition: 'all 0.2s'
            }}
            onClick={() => {
              if (capture.status === 'COMPLETED') {
                fetchCaptureResults(capture.captureRequestId);
              }
            }}
            onMouseOver={(e) => {
              if (capture.status === 'COMPLETED') {
                e.currentTarget.style.backgroundColor = '#f7fafc';
              }
            }}
            onMouseOut={(e) => {
              if (selectedCapture !== capture.captureRequestId) {
                e.currentTarget.style.backgroundColor = 'white';
              }
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: '600', color: '#2d3748', marginBottom: '0.25rem' }}>
                  {formatTimestamp(capture.createdAt)}
                </div>
                <div style={{ fontSize: '0.875rem', color: '#718096' }}>
                  {capture.uploadedCount} / {capture.totalCount} students uploaded
                </div>
              </div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.5rem 1rem',
                backgroundColor: getStatusColor(capture.status) + '20',
                color: getStatusColor(capture.status),
                borderRadius: '8px',
                fontWeight: '600',
                fontSize: '0.875rem'
              }}>
                <span>{getStatusIcon(capture.status)}</span>
                <span>{capture.status}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Results Display */}
      {selectedCapture && captureResults && (
        <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '2px solid #e2e8f0' }}>
          {loadingResults ? (
            <div style={{ textAlign: 'center', color: '#718096', padding: '2rem' }}>
              Loading results...
            </div>
          ) : captureResults.status === 'COMPLETED' && captureResults.positions ? (
            <>
              <h4 style={{
                margin: '0 0 1rem 0',
                color: '#2d3748',
                fontSize: '1.1rem',
                fontWeight: '600'
              }}>
                Seating Positions
              </h4>
              <SeatingGridVisualization 
                positions={captureResults.positions} 
                imageUrls={captureResults.imageUrls ? new Map(Object.entries(captureResults.imageUrls)) : undefined}
              />
              {captureResults.analysisNotes && (
                <div style={{
                  marginTop: '1rem',
                  padding: '1rem',
                  backgroundColor: '#f7fafc',
                  borderRadius: '8px',
                  fontSize: '0.875rem',
                  color: '#4a5568'
                }}>
                  <strong>Analysis Notes:</strong> {captureResults.analysisNotes}
                </div>
              )}
            </>
          ) : captureResults.status === 'FAILED' ? (
            <div style={{
              padding: '1rem',
              backgroundColor: '#fff5f5',
              border: '1px solid #fc8181',
              borderRadius: '8px',
              color: '#c53030'
            }}>
              Analysis failed: {captureResults.errorMessage || 'Unknown error'}
            </div>
          ) : captureResults.status === 'ANALYZING' ? (
            <div style={{
              padding: '1rem',
              backgroundColor: '#fffaf0',
              border: '1px solid #ed8936',
              borderRadius: '8px',
              color: '#c05621',
              textAlign: 'center'
            }}>
              ⟳ Analysis in progress...
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
