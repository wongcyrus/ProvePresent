/**
 * Monitor Tab - Real-time attendance monitoring
 */

import React from 'react';

interface AttendanceRecord {
  sessionId: string;
  studentId: string;
  entryStatus?: 'PRESENT_ENTRY' | 'LATE_ENTRY';
  entryMethod?: 'DIRECT_QR' | 'CHAIN';
  entryAt?: number;
  exitVerified: boolean;
  exitMethod?: 'DIRECT_QR' | 'CHAIN';
  exitedAt?: number;
  earlyLeaveAt?: number;
  finalStatus?: string;
  joinedAt?: number;
  locationWarning?: string;
  locationDistance?: number;
}

interface SessionStats {
  totalStudents: number;
  presentEntry: number;
  lateEntry: number;
  earlyLeave: number;
  exitVerified: number;
  notYetVerified: number;
}

interface MonitorTabProps {
  attendance: AttendanceRecord[];
  stats: SessionStats;
  onlineStudentCount: number;
  onShowEntryQR: () => void;
  onShowExitQR: () => void;
}

export const MonitorTab: React.FC<MonitorTabProps> = ({
  attendance,
  stats,
  onlineStudentCount,
  onShowEntryQR,
  onShowExitQR,
}) => {
  const [showGpsMissingOnly, setShowGpsMissingOnly] = React.useState(false);

  const formatTimestamp = (timestamp?: number): string => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp * 1000).toLocaleTimeString();
  };

  const formatStudentId = (studentId: string): string => {
    if (!studentId) return 'Unknown';
    return studentId.replace('@stu.vtc.edu.hk', '');
  };

  const getStatusText = (record: AttendanceRecord): string => {
    if (record.finalStatus) return record.finalStatus;
    if (record.earlyLeaveAt) return 'Early Leave';
    if (record.entryStatus === 'PRESENT_ENTRY' && record.exitVerified) return 'Present (Verified)';
    if (record.entryStatus === 'LATE_ENTRY' && record.exitVerified) return 'Late (Verified)';
    if (record.entryStatus === 'PRESENT_ENTRY') return 'Present Entry';
    if (record.entryStatus === 'LATE_ENTRY') return 'Late Entry';
    return 'Not Yet Marked';
  };

  const isGpsMissing = (record: AttendanceRecord) => record.locationWarning === 'Location not provided';
  const gpsMissingCount = attendance.filter(isGpsMissing).length;
  const filteredAttendance = showGpsMissingOnly
    ? attendance.filter(isGpsMissing)
    : attendance;

  return (
    <div>
      {/* Quick Actions */}
      <div style={{
        display: 'flex',
        gap: '1rem',
        marginBottom: '1.5rem',
        flexWrap: 'wrap'
      }}>
        <button 
          onClick={onShowEntryQR}
          style={{
            flex: '1 1 200px',
            padding: '1rem 1.5rem',
            backgroundColor: '#48bb78',
            color: 'white',
            border: 'none',
            borderRadius: '12px',
            cursor: 'pointer',
            fontSize: '1rem',
            fontWeight: '600',
            transition: 'all 0.2s',
            boxShadow: '0 4px 12px rgba(72, 187, 120, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem'
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 6px 16px rgba(72, 187, 120, 0.4)';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(72, 187, 120, 0.3)';
          }}
        >
          <span style={{ fontSize: '1.5rem' }}>📥</span>
          Show Entry QR
        </button>
        
        <button 
          onClick={onShowExitQR}
          style={{
            flex: '1 1 200px',
            padding: '1rem 1.5rem',
            backgroundColor: '#ed8936',
            color: 'white',
            border: 'none',
            borderRadius: '12px',
            cursor: 'pointer',
            fontSize: '1rem',
            fontWeight: '600',
            transition: 'all 0.2s',
            boxShadow: '0 4px 12px rgba(237, 137, 54, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem'
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 6px 16px rgba(237, 137, 54, 0.4)';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(237, 137, 54, 0.3)';
          }}
        >
          <span style={{ fontSize: '1.5rem' }}>📤</span>
          Show Exit QR
        </button>
      </div>

      {/* Key Statistics */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '1rem',
        marginBottom: '2rem'
      }}>
        <div style={{
          backgroundColor: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          textAlign: 'center',
          border: '2px solid #667eea'
        }}>
          <div style={{ fontSize: '2.5rem', fontWeight: '700', color: '#667eea', marginBottom: '0.5rem' }}>
            {stats.totalStudents}
          </div>
          <div style={{ color: '#718096', fontSize: '0.875rem', fontWeight: '600' }}>
            Total Students
          </div>
        </div>
        
        <div style={{
          backgroundColor: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          textAlign: 'center',
          border: '2px solid #48bb78'
        }}>
          <div style={{ fontSize: '2.5rem', fontWeight: '700', color: '#48bb78', marginBottom: '0.5rem' }}>
            {onlineStudentCount}
          </div>
          <div style={{ color: '#718096', fontSize: '0.875rem', fontWeight: '600' }}>
            🟢 Online Now
          </div>
        </div>
        
        <div style={{
          backgroundColor: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          textAlign: 'center',
          border: '2px solid #48bb78'
        }}>
          <div style={{ fontSize: '2.5rem', fontWeight: '700', color: '#48bb78', marginBottom: '0.5rem' }}>
            {stats.presentEntry}
          </div>
          <div style={{ color: '#718096', fontSize: '0.875rem', fontWeight: '600' }}>
            Present Entry
          </div>
        </div>
        
        <div style={{
          backgroundColor: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          textAlign: 'center',
          border: '2px solid #ed8936'
        }}>
          <div style={{ fontSize: '2.5rem', fontWeight: '700', color: '#ed8936', marginBottom: '0.5rem' }}>
            {stats.lateEntry}
          </div>
          <div style={{ color: '#718096', fontSize: '0.875rem', fontWeight: '600' }}>
            Late Entry
          </div>
        </div>
      </div>

      {/* Student Attendance Table */}
      <div style={{
        backgroundColor: 'white',
        padding: '2rem',
        borderRadius: '16px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.08)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          <h2 style={{ 
            color: '#2d3748',
            fontSize: '1.5rem',
            margin: 0,
            fontWeight: '700'
          }}>
            👥 Student Attendance ({filteredAttendance.length}{showGpsMissingOnly ? ` / ${attendance.length}` : ''})
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {gpsMissingCount > 0 && (
              <span style={{
                padding: '0.35rem 0.75rem',
                backgroundColor: '#fff3cd',
                color: '#856404',
                borderRadius: '12px',
                fontSize: '0.8rem',
                fontWeight: '600'
              }}>
                ⚠️ GPS missing: {gpsMissingCount}
              </span>
            )}
            <button
              type="button"
              onClick={() => setShowGpsMissingOnly((prev) => !prev)}
              style={{
                padding: '0.4rem 0.75rem',
                backgroundColor: showGpsMissingOnly ? '#2d3748' : '#edf2f7',
                color: showGpsMissingOnly ? 'white' : '#2d3748',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: '600'
              }}
            >
              {showGpsMissingOnly ? 'Show All' : 'Show GPS Missing'}
            </button>
          </div>
        </div>
        
        {filteredAttendance.length === 0 ? (
          <div style={{
            padding: '3rem 2rem',
            textAlign: 'center',
            backgroundColor: '#f7fafc',
            borderRadius: '12px'
          }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>👥</div>
            <p style={{ color: '#718096', fontSize: '1.1rem', margin: 0 }}>
              {showGpsMissingOnly ? 'No students with missing GPS data.' : 'No students have joined this session yet.'}
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '0.95rem'
            }}>
              <thead>
                <tr style={{ backgroundColor: '#f7fafc' }}>
                  <th style={{ 
                    padding: '1rem',
                    textAlign: 'left',
                    fontWeight: '600',
                    color: '#4a5568',
                    borderBottom: '2px solid #e2e8f0'
                  }}>Student ID</th>
                  <th style={{ 
                    padding: '1rem',
                    textAlign: 'center',
                    fontWeight: '600',
                    color: '#4a5568',
                    borderBottom: '2px solid #e2e8f0'
                  }}>Online</th>
                  <th style={{ 
                    padding: '1rem',
                    textAlign: 'center',
                    fontWeight: '600',
                    color: '#4a5568',
                    borderBottom: '2px solid #e2e8f0'
                  }}>Chain Holder</th>
                  <th style={{ 
                    padding: '1rem',
                    textAlign: 'left',
                    fontWeight: '600',
                    color: '#4a5568',
                    borderBottom: '2px solid #e2e8f0'
                  }}>Status</th>
                  <th style={{ 
                    padding: '1rem',
                    textAlign: 'center',
                    fontWeight: '600',
                    color: '#4a5568',
                    borderBottom: '2px solid #e2e8f0'
                  }}>Location</th>
                  <th style={{ 
                    padding: '1rem',
                    textAlign: 'left',
                    fontWeight: '600',
                    color: '#4a5568',
                    borderBottom: '2px solid #e2e8f0'
                  }}>Entry Time</th>
                  <th style={{ 
                    padding: '1rem',
                    textAlign: 'center',
                    fontWeight: '600',
                    color: '#4a5568',
                    borderBottom: '2px solid #e2e8f0'
                  }}>Entry Method</th>
                </tr>
              </thead>
              <tbody>
                {filteredAttendance.map(record => (
                  <tr key={record.studentId} style={{
                    borderBottom: '1px solid #e2e8f0',
                    transition: 'background-color 0.2s'
                  }}
                  onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f7fafc'}
                  onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <td style={{ padding: '1rem', color: '#2d3748', fontWeight: '500' }}>
                      {formatStudentId(record.studentId)}
                    </td>
                    <td style={{ padding: '1rem', textAlign: 'center' }}>
                      <span style={{
                        padding: '0.375rem 0.75rem',
                        backgroundColor: (record as any).isOnline ? '#c6f6d5' : '#e2e8f0',
                        color: (record as any).isOnline ? '#22543d' : '#718096',
                        borderRadius: '12px',
                        fontSize: '0.875rem',
                        fontWeight: '600'
                      }}>
                        {(record as any).isOnline ? '🟢 Online' : '⚪ Offline'}
                      </span>
                    </td>
                    <td style={{ padding: '1rem', textAlign: 'center' }}>
                      {(record as any).isHolder ? (
                        <span style={{
                          padding: '0.375rem 0.75rem',
                          backgroundColor: '#fff3cd',
                          color: '#856404',
                          borderRadius: '12px',
                          fontSize: '0.875rem',
                          fontWeight: '600',
                          border: '2px solid #ffc107'
                        }}>
                          🎯 Holder
                        </span>
                      ) : (
                        <span style={{ color: '#a0aec0', fontSize: '0.875rem' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '1rem' }}>
                      <span style={{
                        padding: '0.375rem 0.75rem',
                        backgroundColor: 
                          record.entryStatus === 'PRESENT_ENTRY' ? '#c6f6d5' :
                          record.entryStatus === 'LATE_ENTRY' ? '#fed7d7' :
                          '#e2e8f0',
                        color:
                          record.entryStatus === 'PRESENT_ENTRY' ? '#22543d' :
                          record.entryStatus === 'LATE_ENTRY' ? '#742a2a' :
                          '#4a5568',
                        borderRadius: '12px',
                        fontSize: '0.875rem',
                        fontWeight: '600'
                      }}>
                        {getStatusText(record)}
                      </span>
                    </td>
                    <td style={{ padding: '1rem', textAlign: 'center' }}>
                      {record.locationWarning ? (
                        <span 
                          style={{
                            padding: '0.375rem 0.75rem',
                            backgroundColor: '#fff3cd',
                            color: '#856404',
                            borderRadius: '12px',
                            fontSize: '0.75rem',
                            fontWeight: '600',
                            display: 'inline-block',
                            cursor: 'help'
                          }}
                          title={record.locationWarning}
                        >
                          ⚠️ Warning
                        </span>
                      ) : (
                        <span style={{ color: '#48bb78', fontSize: '0.875rem' }}>✓</span>
                      )}
                    </td>
                    <td style={{ padding: '1rem', color: '#718096' }}>
                      {formatTimestamp(record.entryAt)}
                    </td>
                    <td style={{ padding: '1rem', textAlign: 'center' }}>
                      {record.entryMethod ? (
                        <span style={{
                          padding: '0.25rem 0.5rem',
                          backgroundColor: record.entryMethod === 'CHAIN' ? '#e0f2fe' : '#fef3c7',
                          color: record.entryMethod === 'CHAIN' ? '#075985' : '#92400e',
                          borderRadius: '8px',
                          fontSize: '0.75rem',
                          fontWeight: '600'
                        }}>
                          {record.entryMethod === 'CHAIN' ? '🔗 Chain' : '📱 QR'}
                        </span>
                      ) : (
                        <span style={{ color: '#a0aec0' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
