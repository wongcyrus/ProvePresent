/**
 * Teacher Dashboard Component with Tab Navigation
 * 
 * Requirements: 12.1, 12.2, 12.3, 12.4
 * 
 * Real-time dashboard for teachers to monitor attendance status and chain progress.
 * Connects to Azure SignalR Service for live updates.
 * 
 * Features organized into tabs:
 * - Monitor: Real-time attendance tracking
 * - Chains: Chain management and troubleshooting
 * - Capture: Photo capture and seating verification
 * - Quiz: AI-powered live quiz system
 * - Session: Session administration and controls
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getAuthHeaders } from '../utils/authHeaders';
import * as signalR from '@microsoft/signalr';
import { TeacherDashboardTabs, type Tab } from './TeacherDashboardTabs';
import { MonitorTab } from './tabs/MonitorTab';
import { ChainsTab } from './tabs/ChainsTab';
import { CaptureTab } from './tabs/CaptureTab';
import { QuizTab } from './tabs/QuizTab';
import { SessionTab } from './tabs/SessionTab';
import { type UploadCompleteEvent, type CaptureExpiredEvent, type CaptureResultsEvent } from './TeacherCaptureControl';

// Type definitions
enum EntryStatus {
  PRESENT_ENTRY = "PRESENT_ENTRY",
  LATE_ENTRY = "LATE_ENTRY"
}

enum FinalStatus {
  PRESENT = "PRESENT",
  LATE = "LATE",
  LEFT_EARLY = "LEFT_EARLY",
  EARLY_LEAVE = "EARLY_LEAVE",
  ABSENT = "ABSENT"
}

enum SessionStatus {
  ACTIVE = "ACTIVE",
  ENDED = "ENDED"
}

enum ChainPhase {
  ENTRY = "ENTRY",
  EXIT = "EXIT"
}

enum ChainState {
  ACTIVE = "ACTIVE",
  STALLED = "STALLED",
  COMPLETED = "COMPLETED"
}

interface SessionConstraints {
  geofence?: {
    latitude: number;
    longitude: number;
    radiusMeters: number;
  };
  wifiAllowlist?: string[];
}

interface Session {
  sessionId: string;
  classId: string;
  teacherId: string;
  startAt: string;
  endAt: string;
  lateCutoffMinutes: number;
  exitWindowMinutes: number;
  status: SessionStatus;
  ownerTransfer: boolean;
  constraints?: SessionConstraints;
  lateEntryActive: boolean;
  currentLateTokenId?: string;
  earlyLeaveActive: boolean;
  currentEarlyTokenId?: string;
  createdAt: string;
  endedAt?: string;
}

interface AttendanceRecord {
  sessionId: string;
  studentId: string;
  entryStatus?: EntryStatus;
  entryMethod?: 'DIRECT_QR' | 'CHAIN';
  entryAt?: number;
  exitVerified: boolean;
  exitMethod?: 'DIRECT_QR' | 'CHAIN';
  exitedAt?: number;
  earlyLeaveAt?: number;
  finalStatus?: FinalStatus;
  joinedAt?: number;
  locationWarning?: string;
  locationDistance?: number;
}

interface Chain {
  sessionId: string;
  phase: ChainPhase;
  chainId: string;
  index: number;
  state: ChainState;
  lastHolder?: string;
  lastSeq: number;
  lastAt?: number;
}

interface SessionStats {
  totalStudents: number;
  presentEntry: number;
  lateEntry: number;
  earlyLeave: number;
  exitVerified: number;
  notYetVerified: number;
}

interface SessionStatusResponse {
  session: Session;
  attendance: AttendanceRecord[];
  chains: Chain[];
  stats: SessionStats;
}

interface AttendanceUpdate {
  studentId: string;
  entryStatus?: EntryStatus;
  exitVerified?: boolean;
  locationWarning?: string;
  earlyLeaveAt?: number;
}

interface ChainUpdate {
  chainId: string;
  phase: ChainPhase;
  lastHolder: string;
  lastSeq: number;
  state: ChainState;
}

interface TeacherDashboardProps {
  sessionId: string;
  onError?: (error: string) => void;
  onShowEntryQR?: () => void;
  onShowExitQR?: () => void;
}

const TeacherDashboardComponent: React.FC<TeacherDashboardProps> = ({
  sessionId,
  onError,
  onShowEntryQR,
  onShowExitQR,
}) => {
  // Tab state
  const [activeTab, setActiveTab] = useState<string>(() => {
    // Restore last active tab from localStorage
    return localStorage.getItem(`teacherDashboard_${sessionId}_activeTab`) || 'monitor';
  });

  // State management
  const [session, setSession] = useState<Session | null>(null);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [chains, setChains] = useState<Chain[]>([]);
  const [stats, setStats] = useState<SessionStats>({
    totalStudents: 0,
    presentEntry: 0,
    lateEntry: 0,
    earlyLeave: 0,
    exitVerified: 0,
    notYetVerified: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [stalledChains, setStalledChains] = useState<string[]>([]);
  
  // Live Quiz state (runs in background regardless of active tab)
  const [quizActive, setQuizActive] = useState(false);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [captureInterval, setCaptureInterval] = useState(30); // seconds
  const [lastCaptureTime, setLastCaptureTime] = useState<number>(0);
  const [quizStats, setQuizStats] = useState({
    capturesCount: 0,
    questionsGenerated: 0,
    questionsSent: 0
  });

  // SignalR connection ref
  const connectionRef = useRef<signalR.HubConnection | null>(null);
  const isConnectingRef = useRef<boolean>(false);

  // Refs for TeacherCaptureControl event handlers
  const uploadCompleteHandlerRef = useRef<((event: UploadCompleteEvent) => void) | null>(null);
  const captureExpiredHandlerRef = useRef<((event: CaptureExpiredEvent) => void) | null>(null);
  const captureResultsHandlerRef = useRef<((event: CaptureResultsEvent) => void) | null>(null);

  // Calculate online student count from attendance records
  const onlineStudentCount = attendance.filter(record => (record as any).isOnline).length;

  // Save active tab to localStorage
  useEffect(() => {
    localStorage.setItem(`teacherDashboard_${sessionId}_activeTab`, activeTab);
  }, [activeTab, sessionId]);

  /**
   * Start screen sharing and continuous capture
   */
  const startScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true
      });
      
      setScreenStream(stream);
      setQuizActive(true);
      setLastCaptureTime(Date.now());
      
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        stopScreenShare();
      });
      
      captureAndAnalyze(stream);
      
    } catch (error: any) {
      setError('Failed to start screen sharing: ' + error.message);
    }
  };

  /**
   * Stop screen sharing
   */
  const stopScreenShare = () => {
    if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());
      setScreenStream(null);
    }
    setQuizActive(false);
  };

  /**
   * Capture screenshot and analyze with AI
   */
  const captureAndAnalyze = async (stream: MediaStream) => {
    try {
      const video = document.createElement('video');
      video.srcObject = stream;
      video.play();
      
      await new Promise(resolve => {
        video.onloadedmetadata = resolve;
      });
      
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(video, 0, 0);
      
      const base64Image = canvas.toDataURL('image/jpeg', 0.8);
      
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '/api';
      const headers = await getAuthHeaders();
      
      const response = await fetch(`${apiUrl}/sessions/${sessionId}/quiz/analyze-slide`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          image: base64Image
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to analyze slide');
      }
      
      const data = await response.json();
      
      setQuizStats(prev => ({
        ...prev,
        capturesCount: prev.capturesCount + 1
      }));
      
      await generateAndSendQuestion(data.slideId, data.analysis, data.imageUrl);
      
    } catch (error: any) {
      console.error('Capture error:', error);
      setError('Failed to capture screen: ' + error.message);
    }
  };

  /**
   * Generate question and send to student automatically
   */
  const generateAndSendQuestion = async (slideId: string, analysis: any, slideImageUrl: string) => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '/api';
      const headers = await getAuthHeaders();
      
      const genResponse = await fetch(`${apiUrl}/sessions/${sessionId}/quiz/generate-questions`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          slideId,
          analysis,
          slideImageUrl,
          difficulty: analysis.difficulty || 'MEDIUM',
          count: 1
        })
      });
      
      if (!genResponse.ok) {
        throw new Error('Failed to generate questions');
      }
      
      const genData = await genResponse.json();
      const questions = genData.questions || [];
      
      if (questions.length === 0) {
        return;
      }
      
      setQuizStats(prev => ({
        ...prev,
        questionsGenerated: prev.questionsGenerated + questions.length
      }));
      
      const question = questions[0];
      const sendResponse = await fetch(`${apiUrl}/sessions/${sessionId}/quiz/send-question`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          questionId: question.questionId,
          timeLimit: 30
        })
      });
      
      if (!sendResponse.ok) {
        const errorData = await sendResponse.json().catch(() => ({}));
        const errorMsg = errorData.error?.message || 'Failed to send question';
        
        if (errorData.error?.code === 'NO_STUDENTS') {
          console.log('No students present yet, skipping question send');
          return;
        }
        
        throw new Error(errorMsg);
      }
      
      const sendData = await sendResponse.json();
      
      setQuizStats(prev => ({
        ...prev,
        questionsSent: prev.questionsSent + 1
      }));
      
      console.log(`Question sent to ${sendData.studentId}`);
      
    } catch (error: any) {
      console.error('Generate/send error:', error);
    }
  };

  /**
   * Continuous capture loop (runs in background)
   */
  useEffect(() => {
    if (!quizActive || !screenStream) {
      return;
    }
    
    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - lastCaptureTime) / 1000;
      
      if (elapsed >= captureInterval) {
        setLastCaptureTime(now);
        captureAndAnalyze(screenStream);
      }
    }, 1000);
    
    return () => clearInterval(interval);
  }, [quizActive, screenStream, lastCaptureTime, captureInterval]);

  /**
   * Fetch initial session data
   */
  const fetchSessionData = useCallback(async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '/api';
      const headers = await getAuthHeaders();
      
      const response = await fetch(`${apiUrl}/sessions/${sessionId}`, { 
        credentials: 'include',
        headers
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error?.message || `Failed to fetch session: ${response.statusText}`
        );
      }
      
      const data: SessionStatusResponse = await response.json();
      
      setSession(data.session);
      setAttendance(data.attendance);
      setChains(data.chains);
      setStats(data.stats);
      
      const stalled = data.chains
        .filter(chain => chain.state === ChainState.STALLED)
        .map(chain => chain.chainId);
      setStalledChains(stalled);
      
      setError(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch session data';
      setError(errorMessage);
      if (onError) {
        onError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  }, [sessionId, onError]);

  /**
   * Handle attendance update from SignalR
   */
  const handleAttendanceUpdate = useCallback((update: AttendanceUpdate) => {
    fetchSessionData();
  }, [fetchSessionData]);

  /**
   * Handle chain update from SignalR
   */
  const handleChainUpdate = useCallback((update: ChainUpdate) => {
    setChains(prev => {
      const index = prev.findIndex(c => c.chainId === update.chainId);
      
      if (index === -1) {
        const newChain: Chain = {
          sessionId,
          chainId: update.chainId,
          phase: update.phase,
          lastHolder: update.lastHolder,
          lastSeq: update.lastSeq,
          state: update.state,
          index: 0,
          lastAt: Date.now() / 1000,
        };
        return [...prev, newChain];
      } else {
        const updated = [...prev];
        updated[index] = {
          ...updated[index],
          lastHolder: update.lastHolder,
          lastSeq: update.lastSeq,
          state: update.state,
          lastAt: Date.now() / 1000,
        };
        return updated;
      }
    });
  }, [sessionId]);

  /**
   * Handle stall alert from SignalR
   */
  const handleStallAlert = useCallback((chainIds: string[]) => {
    setStalledChains(chainIds);
    
    setChains(prev => 
      prev.map(chain => 
        chainIds.includes(chain.chainId)
          ? { ...chain, state: ChainState.STALLED }
          : chain
      )
    );
  }, []);

  /**
   * Register event handlers with SignalR connection
   */
  const registerEventHandlers = useCallback((connection: signalR.HubConnection) => {
    connection.off('attendanceUpdate');
    connection.off('chainUpdate');
    connection.off('stallAlert');
    connection.off('uploadComplete');
    connection.off('captureExpired');
    connection.off('captureResults');
    
    connection.on('attendanceUpdate', handleAttendanceUpdate);
    connection.on('chainUpdate', handleChainUpdate);
    connection.on('stallAlert', handleStallAlert);
    
    connection.on('uploadComplete', (event: UploadCompleteEvent) => {
      if (uploadCompleteHandlerRef.current) {
        uploadCompleteHandlerRef.current(event);
      }
    });
    
    connection.on('captureExpired', (event: CaptureExpiredEvent) => {
      if (captureExpiredHandlerRef.current) {
        captureExpiredHandlerRef.current(event);
      }
    });
    
    connection.on('captureResults', (event: CaptureResultsEvent) => {
      if (captureResultsHandlerRef.current) {
        captureResultsHandlerRef.current(event);
      }
    });
  }, [handleAttendanceUpdate, handleChainUpdate, handleStallAlert]);

  /**
   * Establish SignalR connection
   */
  const connectSignalR = useCallback(async () => {
    if (isConnectingRef.current || connectionRef.current) {
      return;
    }
    
    isConnectingRef.current = true;
    
    try {
      setConnectionStatus('connecting');
      
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '/api';
      const headers = await getAuthHeaders();
      const negotiateResponse = await fetch(`${apiUrl}/sessions/${sessionId}/dashboard/negotiate`, { 
        credentials: 'include',
        method: 'POST',
        headers
      });
      
      if (!negotiateResponse.ok) {
        throw new Error('Failed to negotiate SignalR connection');
      }
      
      const connectionInfo = await negotiateResponse.json();
      
      const connection = new signalR.HubConnectionBuilder()
        .withUrl(connectionInfo.url, {
          accessTokenFactory: () => connectionInfo.accessToken,
        })
        .withAutomaticReconnect({
          nextRetryDelayInMilliseconds: (retryContext) => {
            if (retryContext.previousRetryCount === 0) return 0;
            if (retryContext.previousRetryCount === 1) return 2000;
            if (retryContext.previousRetryCount === 2) return 10000;
            return 30000;
          },
        })
        .configureLogging(signalR.LogLevel.Information)
        .build();
      
      registerEventHandlers(connection);
      
      connection.onreconnecting(() => {
        setConnectionStatus('connecting');
      });
      
      connection.onreconnected(() => {
        setConnectionStatus('connected');
        registerEventHandlers(connection);
        fetchSessionData();
      });
      
      connection.onclose(() => {
        setConnectionStatus('disconnected');
        isConnectingRef.current = false;
        connectionRef.current = null;
      });
      
      await connection.start();
      setConnectionStatus('connected');
      
      connectionRef.current = connection;
      isConnectingRef.current = false;
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to connect to SignalR';
      setError(errorMessage);
      setConnectionStatus('disconnected');
      isConnectingRef.current = false;
      if (onError) {
        onError(errorMessage);
      }
    }
  }, [sessionId, registerEventHandlers, fetchSessionData, onError]);

  /**
   * Initialize dashboard
   */
  useEffect(() => {
    fetchSessionData();
    
    if (!connectionRef.current && !isConnectingRef.current) {
      connectSignalR();
    }
    
    const pollInterval = setInterval(() => {
      if (connectionRef.current?.state !== signalR.HubConnectionState.Connected) {
        fetchSessionData();
      }
    }, 5000);
    
    return () => {
      if (connectionRef.current) {
        connectionRef.current.stop();
        connectionRef.current = null;
      }
      isConnectingRef.current = false;
      clearInterval(pollInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  /**
   * Re-register handlers when they change
   */
  useEffect(() => {
    if (connectionRef.current && connectionRef.current.state === signalR.HubConnectionState.Connected) {
      registerEventHandlers(connectionRef.current);
    }
  }, [handleAttendanceUpdate, handleChainUpdate, handleStallAlert, registerEventHandlers]);

  // Build tabs with dynamic badges
  const tabs: Tab[] = [
    { id: 'monitor', label: 'Monitor', icon: '👥' },
    { 
      id: 'chains', 
      label: 'Chains', 
      icon: '🔗',
      badge: stalledChains.length > 0 ? stalledChains.length : undefined,
      badgeColor: '#ff4d4f'
    },
    { id: 'capture', label: 'Capture', icon: '📸' },
    { 
      id: 'quiz', 
      label: 'Quiz', 
      icon: '🤖',
      badge: quizActive ? '●' : undefined,
      badgeColor: '#52c41a'
    },
    { id: 'session', label: 'Session', icon: '⚙️' }
  ];

  // Loading state
  if (loading) {
    return (
      <div style={{ 
        padding: '4rem 2rem',
        textAlign: 'center',
        backgroundColor: 'white',
        borderRadius: '16px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.08)'
      }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⏳</div>
        <p style={{ color: '#718096', fontSize: '1.1rem' }}>Loading dashboard...</p>
      </div>
    );
  }

  // Error state
  if (error && !session) {
    return (
      <div style={{
        padding: '2rem',
        backgroundColor: 'white',
        borderRadius: '16px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.08)'
      }}>
        <div style={{
          padding: '1.5rem',
          backgroundColor: '#fff5f5',
          border: '2px solid #fc8181',
          borderRadius: '12px',
          marginBottom: '1.5rem',
          color: '#c53030'
        }}>
          <strong>Error:</strong> {error}
        </div>
        <button 
          onClick={fetchSessionData}
          style={{
            padding: '0.875rem 1.5rem',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            color: 'white',
            border: 'none',
            borderRadius: '10px',
            cursor: 'pointer',
            fontSize: '0.95rem',
            fontWeight: '600',
            boxShadow: '0 4px 12px rgba(102, 126, 234, 0.3)'
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div>
      {/* Session Header */}
      <div style={{
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        padding: '2rem',
        borderRadius: '12px',
        marginBottom: '1.5rem',
        color: 'white',
        boxShadow: '0 4px 20px rgba(102, 126, 234, 0.3)'
      }}>
        <h1 style={{
          margin: '0 0 1rem 0',
          fontSize: '2rem',
          fontWeight: '700'
        }}>
          {session.classId}
        </h1>
        <div style={{
          display: 'flex',
          gap: '2rem',
          flexWrap: 'wrap',
          fontSize: '1rem',
          opacity: 0.95
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>📅</span>
            <span>
              {session.startAt && !isNaN(new Date(session.startAt).getTime()) 
                ? new Date(session.startAt).toLocaleDateString() 
                : 'Not set'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>🕐</span>
            <span>
              {session.startAt && !isNaN(new Date(session.startAt).getTime())
                ? new Date(session.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : 'Not set'}
              {' → '}
              {session.endAt && !isNaN(new Date(session.endAt).getTime())
                ? new Date(session.endAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : 'Not set'}
            </span>
          </div>
        </div>
      </div>

      {/* Status Header */}
      <div style={{
        backgroundColor: 'white',
        padding: '1.5rem 2rem',
        borderRadius: '12px',
        marginBottom: '1.5rem',
        boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <span style={{
            padding: '0.5rem 1rem',
            backgroundColor: session.status === 'ACTIVE' ? '#48bb78' : '#a0aec0',
            color: 'white',
            borderRadius: '20px',
            fontSize: '0.875rem',
            fontWeight: '700',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            {session.status}
          </span>
          <span style={{
            padding: '0.5rem 1rem',
            backgroundColor: connectionStatus === 'connected' ? '#48bb78' : connectionStatus === 'connecting' ? '#ed8936' : '#e53e3e',
            color: 'white',
            borderRadius: '20px',
            fontSize: '0.875rem',
            fontWeight: '600'
          }}>
            {connectionStatus === 'connected' && '🟢 Live'}
            {connectionStatus === 'connecting' && '🟡 Connecting...'}
            {connectionStatus === 'disconnected' && '🔴 Disconnected'}
          </span>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          padding: '1rem 1.25rem',
          backgroundColor: '#fff5f5',
          border: '2px solid #fc8181',
          borderRadius: '10px',
          marginBottom: '1.5rem',
          color: '#c53030'
        }}>
          {error}
        </div>
      )}

      {/* Tab Navigation */}
      <TeacherDashboardTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tabs={tabs}
      />

      {/* Tab Content */}
      {activeTab === 'monitor' && (
        <MonitorTab
          attendance={attendance}
          stats={stats}
          onlineStudentCount={onlineStudentCount}
          onShowEntryQR={onShowEntryQR || (() => {})}
          onShowExitQR={onShowExitQR || (() => {})}
        />
      )}

      {activeTab === 'chains' && (
        <ChainsTab
          sessionId={sessionId}
          chains={chains}
          stalledChains={stalledChains}
          onChainsUpdated={fetchSessionData}
          onError={(error) => {
            setError(error);
            if (onError) {
              onError(error);
            }
          }}
        />
      )}

      {activeTab === 'capture' && (
        <CaptureTab
          sessionId={sessionId}
          sessionStatus={session.status}
          onlineStudentCount={onlineStudentCount}
          onError={(error) => {
            setError(error);
            if (onError) {
              onError(error);
            }
          }}
          uploadCompleteHandlerRef={uploadCompleteHandlerRef}
          captureExpiredHandlerRef={captureExpiredHandlerRef}
          captureResultsHandlerRef={captureResultsHandlerRef}
        />
      )}

      {activeTab === 'quiz' && (
        <QuizTab
          sessionStatus={session.status}
          quizActive={quizActive}
          captureInterval={captureInterval}
          lastCaptureTime={lastCaptureTime}
          quizStats={quizStats}
          onStartScreenShare={startScreenShare}
          onStopScreenShare={stopScreenShare}
          onCaptureIntervalChange={setCaptureInterval}
        />
      )}

      {activeTab === 'session' && (
        <SessionTab
          session={session}
          sessionId={sessionId}
          onSessionEnded={(finalAttendance) => {
            fetchSessionData();
          }}
          onError={(error) => {
            setError(error);
            if (onError) {
              onError(error);
            }
          }}
        />
      )}
    </div>
  );
};

export const TeacherDashboard = React.memo(TeacherDashboardComponent);
