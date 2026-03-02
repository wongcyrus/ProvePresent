/**
 * Quiz Tab - Live AI-powered quiz system
 */

import React from 'react';

interface QuizStats {
  capturesCount: number;
  questionsGenerated: number;
  questionsSent: number;
}

interface QuizTabProps {
  sessionStatus: string;
  quizActive: boolean;
  captureInterval: number;
  lastCaptureTime: number;
  quizStats: QuizStats;
  onStartScreenShare: () => void;
  onStopScreenShare: () => void;
  onCaptureIntervalChange: (interval: number) => void;
}

export const QuizTab: React.FC<QuizTabProps> = ({
  sessionStatus,
  quizActive,
  captureInterval,
  lastCaptureTime,
  quizStats,
  onStartScreenShare,
  onStopScreenShare,
  onCaptureIntervalChange,
}) => {
  // Calculate next capture countdown
  const [countdown, setCountdown] = React.useState(0);
  
  React.useEffect(() => {
    if (!quizActive) return;
    
    const updateCountdown = () => {
      const elapsed = (Date.now() - lastCaptureTime) / 1000;
      const remaining = Math.max(0, captureInterval - Math.floor(elapsed));
      setCountdown(remaining);
    };
    
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    
    return () => clearInterval(interval);
  }, [quizActive, lastCaptureTime, captureInterval]);

  if (sessionStatus !== 'ACTIVE') {
    return (
      <div style={{
        backgroundColor: 'white',
        padding: '3rem 2rem',
        borderRadius: '16px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
        textAlign: 'center'
      }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🤖</div>
        <h3 style={{ color: '#2d3748', marginBottom: '0.5rem' }}>Live Quiz Unavailable</h3>
        <p style={{ color: '#718096', margin: 0 }}>
          Live quiz is only available for active sessions.
        </p>
      </div>
    );
  }

  return (
    <div style={{ 
      padding: '2rem',
      backgroundColor: quizActive ? '#e6f7ff' : 'white',
      border: `2px solid ${quizActive ? '#1890ff' : '#e2e8f0'}`,
      borderRadius: '16px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.08)'
    }}>
      <h3 style={{ 
        margin: '0 0 1rem 0',
        color: '#0078d4',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        fontSize: '1.5rem'
      }}>
        🤖 Live Quiz (AI-Powered)
        {quizActive && <span style={{ 
          fontSize: '0.9rem',
          padding: '0.35rem 0.85rem',
          backgroundColor: '#52c41a',
          color: 'white',
          borderRadius: '16px',
          fontWeight: '600'
        }}>● ACTIVE</span>}
      </h3>
      
      {!quizActive ? (
        <>
          <p style={{ margin: '0 0 1.5rem 0', fontSize: '1rem', color: '#4a5568', lineHeight: '1.6' }}>
            Share your screen to automatically capture slides and generate quiz questions for students.
            The quiz will continue running in the background even when you switch to other tabs.
          </p>
          
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ 
              display: 'block', 
              marginBottom: '0.75rem', 
              fontWeight: '600',
              color: '#2d3748',
              fontSize: '0.95rem'
            }}>
              Capture Frequency:
            </label>
            <select
              value={captureInterval}
              onChange={(e) => onCaptureIntervalChange(Number(e.target.value))}
              style={{
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                border: '2px solid #e2e8f0',
                fontSize: '0.95rem',
                width: '100%',
                maxWidth: '300px',
                cursor: 'pointer',
                backgroundColor: 'white'
              }}
            >
              <option value={15}>Every 15 seconds</option>
              <option value={30}>Every 30 seconds</option>
              <option value={60}>Every 60 seconds</option>
              <option value={120}>Every 2 minutes</option>
              <option value={300}>Every 5 minutes</option>
            </select>
          </div>
          
          <button
            onClick={onStartScreenShare}
            style={{
              padding: '1rem 2rem',
              backgroundColor: '#0078d4',
              color: 'white',
              border: 'none',
              borderRadius: '10px',
              cursor: 'pointer',
              fontSize: '1.05rem',
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              boxShadow: '0 4px 12px rgba(0, 120, 212, 0.3)',
              transition: 'all 0.2s'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 6px 16px rgba(0, 120, 212, 0.4)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 120, 212, 0.3)';
            }}
          >
            <span style={{ fontSize: '1.5rem' }}>🖥️</span>
            Start Screen Share
          </button>
        </>
      ) : (
        <div>
          <div style={{ 
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '1rem',
            marginBottom: '1.5rem'
          }}>
            <div style={{
              padding: '1.5rem',
              backgroundColor: 'white',
              borderRadius: '12px',
              textAlign: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
            }}>
              <div style={{ fontSize: '2rem', fontWeight: '700', color: '#1890ff', marginBottom: '0.5rem' }}>
                {quizStats.capturesCount}
              </div>
              <div style={{ fontSize: '0.85rem', color: '#718096', fontWeight: '600' }}>Captures</div>
            </div>
            
            <div style={{
              padding: '1.5rem',
              backgroundColor: 'white',
              borderRadius: '12px',
              textAlign: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
            }}>
              <div style={{ fontSize: '2rem', fontWeight: '700', color: '#52c41a', marginBottom: '0.5rem' }}>
                {quizStats.questionsGenerated}
              </div>
              <div style={{ fontSize: '0.85rem', color: '#718096', fontWeight: '600' }}>Questions</div>
            </div>
            
            <div style={{
              padding: '1.5rem',
              backgroundColor: 'white',
              borderRadius: '12px',
              textAlign: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
            }}>
              <div style={{ fontSize: '2rem', fontWeight: '700', color: '#fa8c16', marginBottom: '0.5rem' }}>
                {quizStats.questionsSent}
              </div>
              <div style={{ fontSize: '0.85rem', color: '#718096', fontWeight: '600' }}>Sent</div>
            </div>
            
            <div style={{
              padding: '1.5rem',
              backgroundColor: 'white',
              borderRadius: '12px',
              textAlign: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
            }}>
              <div style={{ fontSize: '2rem', fontWeight: '700', color: '#722ed1', marginBottom: '0.5rem' }}>
                {countdown}s
              </div>
              <div style={{ fontSize: '0.85rem', color: '#718096', fontWeight: '600' }}>Next Capture</div>
            </div>
          </div>
          
          <div style={{ 
            padding: '1rem 1.25rem',
            backgroundColor: '#fff7e6',
            borderRadius: '10px',
            marginBottom: '1.5rem',
            fontSize: '0.9rem',
            color: '#ad6800',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.75rem',
            lineHeight: '1.5'
          }}>
            <span style={{ fontSize: '1.2rem' }}>ℹ️</span>
            <div>
              <strong>Quiz is running in the background.</strong> Screen is being captured every {captureInterval} seconds. 
              AI will automatically generate and send questions to students. You can switch to other tabs while this continues.
            </div>
          </div>
          
          <button
            onClick={onStopScreenShare}
            style={{
              padding: '1rem 2rem',
              backgroundColor: '#ff4d4f',
              color: 'white',
              border: 'none',
              borderRadius: '10px',
              cursor: 'pointer',
              fontSize: '1.05rem',
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              boxShadow: '0 4px 12px rgba(255, 77, 79, 0.3)',
              transition: 'all 0.2s'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 6px 16px rgba(255, 77, 79, 0.4)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(255, 77, 79, 0.3)';
            }}
          >
            <span style={{ fontSize: '1.5rem' }}>⏹️</span>
            Stop Screen Share
          </button>
        </div>
      )}
    </div>
  );
};
