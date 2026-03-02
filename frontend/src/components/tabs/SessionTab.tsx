/**
 * Session Tab - Session administration and controls
 */

import React from 'react';
import { SessionEndAndExportControls } from '../SessionEndAndExportControls';

interface Session {
  sessionId: string;
  classId: string;
  teacherId: string;
  startAt: string;
  endAt: string;
  lateCutoffMinutes: number;
  exitWindowMinutes: number;
  status: string;
  ownerTransfer: boolean;
  constraints?: {
    geofence?: {
      latitude: number;
      longitude: number;
      radiusMeters: number;
    };
    wifiAllowlist?: string[];
  };
  lateEntryActive: boolean;
  currentLateTokenId?: string;
  earlyLeaveActive: boolean;
  currentEarlyTokenId?: string;
  createdAt: string;
  endedAt?: string;
}

interface SessionTabProps {
  session: Session;
  sessionId: string;
  onSessionEnded: (finalAttendance: any) => void;
  onError: (error: string) => void;
}

export const SessionTab: React.FC<SessionTabProps> = ({
  session,
  sessionId,
  onSessionEnded,
  onError,
}) => {
  return (
    <div>
      {/* Session Details */}
      <div style={{
        backgroundColor: 'white',
        padding: '2rem',
        borderRadius: '16px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
        marginBottom: '2rem'
      }}>
        <h3 style={{ 
          margin: '0 0 1.5rem 0',
          color: '#2d3748',
          fontSize: '1.5rem',
          fontWeight: '700',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}>
          📋 Session Details
        </h3>
        
        <div style={{ 
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: '1.5rem'
        }}>
          <div>
            <div style={{ 
              fontSize: '0.85rem',
              color: '#718096',
              fontWeight: '600',
              marginBottom: '0.5rem',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              Class ID
            </div>
            <div style={{ fontSize: '1.1rem', color: '#2d3748', fontWeight: '600' }}>
              {session.classId}
            </div>
          </div>
          
          <div>
            <div style={{ 
              fontSize: '0.85rem',
              color: '#718096',
              fontWeight: '600',
              marginBottom: '0.5rem',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              Status
            </div>
            <span style={{
              padding: '0.5rem 1rem',
              backgroundColor: session.status === 'ACTIVE' ? '#c6f6d5' : '#e2e8f0',
              color: session.status === 'ACTIVE' ? '#22543d' : '#4a5568',
              borderRadius: '20px',
              fontSize: '0.9rem',
              fontWeight: '700',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              display: 'inline-block'
            }}>
              {session.status}
            </span>
          </div>
          
          <div>
            <div style={{ 
              fontSize: '0.85rem',
              color: '#718096',
              fontWeight: '600',
              marginBottom: '0.5rem',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              Start Time
            </div>
            <div style={{ fontSize: '1.1rem', color: '#2d3748', fontWeight: '600' }}>
              {session.startAt && !isNaN(new Date(session.startAt).getTime())
                ? new Date(session.startAt).toLocaleString()
                : 'Not set'}
            </div>
          </div>
          
          <div>
            <div style={{ 
              fontSize: '0.85rem',
              color: '#718096',
              fontWeight: '600',
              marginBottom: '0.5rem',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              End Time
            </div>
            <div style={{ fontSize: '1.1rem', color: '#2d3748', fontWeight: '600' }}>
              {session.endAt && !isNaN(new Date(session.endAt).getTime())
                ? new Date(session.endAt).toLocaleString()
                : 'Not set'}
            </div>
          </div>
          
          <div>
            <div style={{ 
              fontSize: '0.85rem',
              color: '#718096',
              fontWeight: '600',
              marginBottom: '0.5rem',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              Late Cutoff
            </div>
            <div style={{ fontSize: '1.1rem', color: '#2d3748', fontWeight: '600' }}>
              {session.lateCutoffMinutes} minutes
            </div>
          </div>
          
          <div>
            <div style={{ 
              fontSize: '0.85rem',
              color: '#718096',
              fontWeight: '600',
              marginBottom: '0.5rem',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              Exit Window
            </div>
            <div style={{ fontSize: '1.1rem', color: '#2d3748', fontWeight: '600' }}>
              {session.exitWindowMinutes} minutes
            </div>
          </div>
        </div>

        {/* Constraints Section */}
        {session.constraints && (
          <div style={{ marginTop: '2rem', paddingTop: '2rem', borderTop: '2px solid #e2e8f0' }}>
            <h4 style={{ 
              margin: '0 0 1rem 0',
              color: '#2d3748',
              fontSize: '1.2rem',
              fontWeight: '700'
            }}>
              Session Constraints
            </h4>
            
            {session.constraints.geofence && (
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ 
                  fontSize: '0.85rem',
                  color: '#718096',
                  fontWeight: '600',
                  marginBottom: '0.5rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}>
                  Geofence
                </div>
                <div style={{ fontSize: '0.95rem', color: '#2d3748' }}>
                  📍 Lat: {session.constraints.geofence.latitude}, 
                  Lng: {session.constraints.geofence.longitude}, 
                  Radius: {session.constraints.geofence.radiusMeters}m
                </div>
              </div>
            )}
            
            {session.constraints.wifiAllowlist && session.constraints.wifiAllowlist.length > 0 && (
              <div>
                <div style={{ 
                  fontSize: '0.85rem',
                  color: '#718096',
                  fontWeight: '600',
                  marginBottom: '0.5rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}>
                  WiFi Allowlist
                </div>
                <div style={{ 
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '0.5rem'
                }}>
                  {session.constraints.wifiAllowlist.map((ssid, index) => (
                    <span key={index} style={{
                      padding: '0.375rem 0.75rem',
                      backgroundColor: '#e0f2fe',
                      color: '#075985',
                      borderRadius: '8px',
                      fontSize: '0.85rem',
                      fontWeight: '600'
                    }}>
                      📶 {ssid}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Session End and Export Controls */}
      <div style={{ marginBottom: '2rem' }}>
        <SessionEndAndExportControls
          sessionId={sessionId}
          sessionStatus={session.status as any}
          onSessionEnded={onSessionEnded}
          onError={onError}
        />
      </div>
    </div>
  );
};
