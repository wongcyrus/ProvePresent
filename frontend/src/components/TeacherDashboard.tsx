/**
 * Teacher Dashboard Component
 * 
 * Requirements: 12.1, 12.2, 12.3, 12.4
 * 
 * Real-time dashboard for teachers to monitor attendance status and chain progress.
 * Connects to Azure SignalR Service for live updates.
 * 
 * Features:
 * - Real-time attendance counts by status
 * - Chain status display with stall indicators
 * - Student list with current status
 * - SignalR connection for push updates
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getAuthHeaders } from '../utils/authHeaders';
import * as signalR from '@microsoft/signalr';
import { ChainManagementControls } from './ChainManagementControls';
import { SessionEndAndExportControls } from './SessionEndAndExportControls';
import { SnapshotManager } from './SnapshotManager';
import { TeacherCaptureControl, type UploadCompleteEvent, type CaptureExpiredEvent, type CaptureResultsEvent } from './TeacherCaptureControl';
import { CaptureHistory } from './CaptureHistory';

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
  entryMethod?: 'DIRECT_QR' | 'CHAIN'; // How entry was verified
  entryAt?: number;
  exitVerified: boolean;
  exitMethod?: 'DIRECT_QR' | 'CHAIN'; // How exit was verified
  exitedAt?: number; // Exit timestamp
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
}

const TeacherDashboardComponent: React.FC<TeacherDashboardProps> = ({
  sessionId,
  onError,
}) => {
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
  const [showGpsMissingOnly, setShowGpsMissingOnly] = useState(false);
  
  // Live Quiz state
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

  /**
   * Start screen sharing and continuous capture
   */
  const startScreenShare = async () => {
    try {
      // Request screen sharing permission
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true
      });
      
      setScreenStream(stream);
      setQuizActive(true);
      setLastCaptureTime(Date.now());
      
      // Handle stream end (user stops sharing)
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        stopScreenShare();
      });
      
      // Start first capture immediately
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
      // Create video element to capture frame
      const video = document.createElement('video');
      video.srcObject = stream;
      video.play();
      
      // Wait for video to be ready
      await new Promise(resolve => {
        video.onloadedmetadata = resolve;
      });
      
      // Create canvas and capture frame
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(video, 0, 0);
      
      // Convert to base64
      const base64Image = canvas.toDataURL('image/jpeg', 0.8);
      
      // Send to backend for analysis
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
      
      // Update stats
      setQuizStats(prev => ({
        ...prev,
        capturesCount: prev.capturesCount + 1
      }));
      
      // Generate and send question automatically
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
      
      // Generate questions
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
          count: 1 // Generate 1 question per capture
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
      
      // Update stats
      setQuizStats(prev => ({
        ...prev,
        questionsGenerated: prev.questionsGenerated + questions.length
      }));
      
      // Send first question to student
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
          timeLimit: 30 // 30 seconds to answer
        })
      });
      
      if (!sendResponse.ok) {
        const errorData = await sendResponse.json().catch(() => ({}));
        const errorMsg = errorData.error?.message || 'Failed to send question';
        
        // If no students, just log and continue (don't throw error)
        if (errorData.error?.code === 'NO_STUDENTS') {
          console.log('No students present yet, skipping question send');
          return;
        }
        
        throw new Error(errorMsg);
      }
      
      const sendData = await sendResponse.json();
      
      // Update stats
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
   * Continuous capture loop
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
    }, 1000); // Check every second
    
    return () => clearInterval(interval);
  }, [quizActive, screenStream, lastCaptureTime, captureInterval]);


  // Calculate online student count from attendance records
  const onlineStudentCount = attendance.filter(record => (record as any).isOnline).length;

  /**
   * Fetch initial session data
   * Requirements: 12.4
   */
  const fetchSessionData = useCallback(async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '/api';
      
      // Create headers with authentication
      const headers = await getAuthHeaders();
      
      const response = await fetch(`${apiUrl}/sessions/${sessionId}`, { credentials: 'include',
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
      
      // Identify stalled chains (Requirement 12.3)
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
   * Requirements: 12.1
   */
  const handleAttendanceUpdate = useCallback((update: AttendanceUpdate) => {
    // When attendance changes, refetch full data to get all fields including methods
    fetchSessionData();
  }, [fetchSessionData]);

  /**
   * Handle chain update from SignalR
   * Requirements: 12.2
   */
  const handleChainUpdate = useCallback((update: ChainUpdate) => {
    setChains(prev => {
      const index = prev.findIndex(c => c.chainId === update.chainId);
      
      if (index === -1) {
        // New chain
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
        // Update existing chain
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

  const isGpsMissing = (record: AttendanceRecord) => record.locationWarning === 'Location not provided';
  const gpsMissingCount = attendance.filter(isGpsMissing).length;
  const filteredAttendance = showGpsMissingOnly
    ? attendance.filter(isGpsMissing)
    : attendance;

  /**
   * Handle stall alert from SignalR
   * Requirements: 12.3
   */
  const handleStallAlert = useCallback((chainIds: string[]) => {
    setStalledChains(chainIds);
    
    // Update chain states
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
   * Deregisters old handlers and registers new ones to avoid stale closures
   */
  const registerEventHandlers = useCallback((connection: signalR.HubConnection) => {
    // Deregister old handlers first
    connection.off('attendanceUpdate');
    connection.off('chainUpdate');
    connection.off('stallAlert');
    connection.off('uploadComplete');
    connection.off('captureExpired');
    connection.off('captureResults');
    
    // Register new handlers
    connection.on('attendanceUpdate', handleAttendanceUpdate);
    connection.on('chainUpdate', handleChainUpdate);
    connection.on('stallAlert', handleStallAlert);
    
    // Register capture event handlers
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
   * Requirements: 12.1, 12.2, 12.3, 12.6
   */
  const connectSignalR = useCallback(async () => {
    // Prevent multiple simultaneous connection attempts
    if (isConnectingRef.current || connectionRef.current) {
      return;
    }
    
    isConnectingRef.current = true;
    
    try {
      setConnectionStatus('connecting');
      
      // Negotiate connection with backend
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '/api';
      const headers = await getAuthHeaders();
      const negotiateResponse = await fetch(`${apiUrl}/sessions/${sessionId}/dashboard/negotiate`, { credentials: 'include',
        method: 'POST',
        headers
      });
      
      if (!negotiateResponse.ok) {
        throw new Error('Failed to negotiate SignalR connection');
      }
      
      const connectionInfo = await negotiateResponse.json();
      
      // Create SignalR connection
      const connection = new signalR.HubConnectionBuilder()
        .withUrl(connectionInfo.url, {
          accessTokenFactory: () => connectionInfo.accessToken,
        })
        .withAutomaticReconnect({
          nextRetryDelayInMilliseconds: (retryContext) => {
            // Exponential backoff: 0s, 2s, 10s, 30s, then 30s
            if (retryContext.previousRetryCount === 0) return 0;
            if (retryContext.previousRetryCount === 1) return 2000;
            if (retryContext.previousRetryCount === 2) return 10000;
            return 30000;
          },
        })
        .configureLogging(signalR.LogLevel.Information)
        .build();
      
      // Register event handlers
      registerEventHandlers(connection);
      
      // Handle reconnection events
      connection.onreconnecting(() => {
        setConnectionStatus('connecting');
      });
      
      connection.onreconnected(() => {
        setConnectionStatus('connected');
        // Re-register handlers after reconnection to ensure latest closures
        registerEventHandlers(connection);
        // Refresh data after reconnection
        fetchSessionData();
      });
      
      connection.onclose(() => {
        setConnectionStatus('disconnected');
        isConnectingRef.current = false;
        connectionRef.current = null;
      });
      
      // Start connection
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
    // Only run once when sessionId changes
    // Fetch initial data
    fetchSessionData();
    
    // Connect to SignalR only if not already connected
    if (!connectionRef.current && !isConnectingRef.current) {
      connectSignalR();
    }
    
    // Fallback polling for local dev (when SignalR is not available)
    // Poll every 5 seconds to update online status and holder info
    const pollInterval = setInterval(() => {
      if (connectionRef.current?.state !== signalR.HubConnectionState.Connected) {
        // Only poll if SignalR is not connected
        fetchSessionData();
      }
    }, 5000); // 5 seconds
    
    // Cleanup on unmount
    return () => {
      if (connectionRef.current) {
        connectionRef.current.stop();
        connectionRef.current = null;
      }
      isConnectingRef.current = false;
      clearInterval(pollInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]); // ONLY depend on sessionId - nothing else!

  /**
   * Re-register handlers when they change to avoid stale closures
   * This ensures SignalR always calls handlers with current state
   */
  useEffect(() => {
    if (connectionRef.current && connectionRef.current.state === signalR.HubConnectionState.Connected) {
      // Re-register handlers with fresh closures
      registerEventHandlers(connectionRef.current);
    }
  }, [handleAttendanceUpdate, handleChainUpdate, handleStallAlert, registerEventHandlers]);

  /**
   * Format timestamp for display
   */
  const formatTimestamp = (timestamp?: number): string => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp * 1000).toLocaleTimeString();
  };

  /**
   * Format student ID by removing @stu.vtc.edu.hk domain
   */
  const formatStudentId = (studentId: string): string => {
    if (!studentId) return 'Unknown';
    return studentId.replace('@stu.vtc.edu.hk', '');
  };

  /**
   * Get status badge class
   */
  const getStatusBadgeClass = (record: AttendanceRecord): string => {
    if (record.earlyLeaveAt) return 'status-early-leave';
    if (record.entryStatus === EntryStatus.PRESENT_ENTRY && record.exitVerified) return 'status-present';
    if (record.entryStatus === EntryStatus.LATE_ENTRY && record.exitVerified) return 'status-late';
    if (record.entryStatus === EntryStatus.PRESENT_ENTRY) return 'status-present-entry';
    if (record.entryStatus === EntryStatus.LATE_ENTRY) return 'status-late-entry';
    return 'status-absent';
  };

  /**
   * Get status display text
   */
  const getStatusText = (record: AttendanceRecord): string => {
    if (record.finalStatus) return record.finalStatus;
    if (record.earlyLeaveAt) return 'Early Leave';
    if (record.entryStatus === EntryStatus.PRESENT_ENTRY && record.exitVerified) return 'Present (Verified)';
    if (record.entryStatus === EntryStatus.LATE_ENTRY && record.exitVerified) return 'Late (Verified)';
    if (record.entryStatus === EntryStatus.PRESENT_ENTRY) return 'Present Entry';
    if (record.entryStatus === EntryStatus.LATE_ENTRY) return 'Late Entry';
    return 'Not Yet Marked';
  };

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
      {/* Session Title and Times Header */}
      <div style={{
        backgroundColor: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
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

      {/* Session Status Header */}
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

      {/* Statistics Cards */}
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
        
        <div style={{
          backgroundColor: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          textAlign: 'center',
          border: '2px solid #f6ad55'
        }}>
          <div style={{ fontSize: '2.5rem', fontWeight: '700', color: '#f6ad55', marginBottom: '0.5rem' }}>
            {stats.earlyLeave}
          </div>
          <div style={{ color: '#718096', fontSize: '0.875rem', fontWeight: '600' }}>
            Early Leave
          </div>
        </div>
        
        <div style={{
          backgroundColor: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          textAlign: 'center',
          border: '2px solid #4299e1'
        }}>
          <div style={{ fontSize: '2.5rem', fontWeight: '700', color: '#4299e1', marginBottom: '0.5rem' }}>
            {stats.exitVerified}
          </div>
          <div style={{ color: '#718096', fontSize: '0.875rem', fontWeight: '600' }}>
            Exit Verified
          </div>
        </div>
        
        <div style={{
          backgroundColor: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          textAlign: 'center',
          border: '2px solid #a0aec0'
        }}>
          <div style={{ fontSize: '2.5rem', fontWeight: '700', color: '#a0aec0', marginBottom: '0.5rem' }}>
            {stats.notYetVerified}
          </div>
          <div style={{ color: '#718096', fontSize: '0.875rem', fontWeight: '600' }}>
            Not Yet Verified
          </div>
        </div>
      </div>

      {/* Chain Management Controls */}
      <div style={{ marginBottom: '2rem' }}>
        <ChainManagementControls
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
      </div>

      {/* Snapshot Manager */}
      <div style={{ marginBottom: '2rem' }}>
        <SnapshotManager
          sessionId={sessionId}
          onError={(error) => {
            setError(error);
            if (onError) {
              onError(error);
            }
          }}
        />
      </div>

      {/* Session End and Export Controls */}
      <div style={{ marginBottom: '2rem' }}>
        <SessionEndAndExportControls
          sessionId={sessionId}
          sessionStatus={session.status}
          onSessionEnded={(finalAttendance) => {
            // Refresh session data after ending
            fetchSessionData();
          }}
          onError={(error) => {
            setError(error);
            if (onError) {
              onError(error);
            }
          }}
        />
      </div>

      {/* Teacher Capture Control */}
      <div style={{ marginBottom: '2rem' }}>
        <TeacherCaptureControl
          sessionId={sessionId}
          sessionStatus={session.status}
          onlineStudentCount={onlineStudentCount}
          onError={(error) => {
            setError(error);
            if (onError) {
              onError(error);
            }
          }}
          ref={(instance) => {
            if (instance) {
              // Store handler refs so SignalR can call them
              uploadCompleteHandlerRef.current = instance.handleUploadComplete;
              captureExpiredHandlerRef.current = instance.handleCaptureExpired;
              captureResultsHandlerRef.current = instance.handleCaptureResults;
            }
          }}
        />
      </div>

      {/* Capture History */}
      <div style={{ marginBottom: '2rem' }}>
        <CaptureHistory
          sessionId={sessionId}
          onError={(error) => {
            setError(error);
            if (onError) {
              onError(error);
            }
          }}
        />
      </div>

      {/* Live Quiz Controls */}
      {session.status === 'ACTIVE' && (
        <div style={{ 
          marginBottom: '2rem',
          padding: '1.5rem',
          backgroundColor: quizActive ? '#e6f7ff' : '#f0f9ff',
          border: `2px solid ${quizActive ? '#1890ff' : '#0078d4'}`,
          borderRadius: '8px'
        }}>
          <h3 style={{ 
            margin: '0 0 1rem 0',
            color: '#0078d4',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            🤖 Live Quiz (AI-Powered)
            {quizActive && <span style={{ 
              fontSize: '0.8rem',
              padding: '0.25rem 0.75rem',
              backgroundColor: '#52c41a',
              color: 'white',
              borderRadius: '12px',
              fontWeight: '600'
            }}>● ACTIVE</span>}
          </h3>
          
          {!quizActive ? (
            <>
              <p style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', color: '#666' }}>
                Share your screen to automatically capture slides and generate quiz questions for students.
              </p>
              
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
                  Capture Frequency:
                </label>
                <select
                  value={captureInterval}
                  onChange={(e) => setCaptureInterval(Number(e.target.value))}
                  style={{
                    padding: '0.5rem',
                    borderRadius: '4px',
                    border: '1px solid #d9d9d9',
                    fontSize: '0.9rem'
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
                onClick={startScreenShare}
                style={{
                  padding: '0.75rem 1.5rem',
                  backgroundColor: '#0078d4',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  fontWeight: '600',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}
              >
                🖥️ Start Screen Share
              </button>
            </>
          ) : (
            <div>
              <div style={{ 
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: '1rem',
                marginBottom: '1rem'
              }}>
                <div style={{
                  padding: '1rem',
                  backgroundColor: 'white',
                  borderRadius: '4px',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#1890ff' }}>
                    {quizStats.capturesCount}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#666' }}>Captures</div>
                </div>
                
                <div style={{
                  padding: '1rem',
                  backgroundColor: 'white',
                  borderRadius: '4px',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#52c41a' }}>
                    {quizStats.questionsGenerated}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#666' }}>Questions</div>
                </div>
                
                <div style={{
                  padding: '1rem',
                  backgroundColor: 'white',
                  borderRadius: '4px',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#fa8c16' }}>
                    {quizStats.questionsSent}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#666' }}>Sent</div>
                </div>
                
                <div style={{
                  padding: '1rem',
                  backgroundColor: 'white',
                  borderRadius: '4px',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#722ed1' }}>
                    {Math.max(0, captureInterval - Math.floor((Date.now() - lastCaptureTime) / 1000))}s
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#666' }}>Next Capture</div>
                </div>
              </div>
              
              <div style={{ 
                padding: '0.75rem',
                backgroundColor: '#fff7e6',
                borderRadius: '4px',
                marginBottom: '1rem',
                fontSize: '0.85rem',
                color: '#ad6800'
              }}>
                ℹ️ Screen is being captured every {captureInterval} seconds. AI will automatically generate and send questions to students.
              </div>
              
              <button
                onClick={stopScreenShare}
                style={{
                  padding: '0.75rem 1.5rem',
                  backgroundColor: '#ff4d4f',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  fontWeight: '600'
                }}
              >
                ⏹️ Stop Screen Share
              </button>
            </div>
          )}
        </div>
      )}

      {/* Student List */}
      <div style={{
        backgroundColor: 'white',
        padding: '2rem',
        borderRadius: '16px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
        marginTop: '2rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '1.5rem' }}>
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
              No students have joined this session yet.
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
                  }}>Join Time</th>
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
                  <th style={{ 
                    padding: '1rem',
                    textAlign: 'left',
                    fontWeight: '600',
                    color: '#4a5568',
                    borderBottom: '2px solid #e2e8f0'
                  }}>Exit Time</th>
                  <th style={{ 
                    padding: '1rem',
                    textAlign: 'center',
                    fontWeight: '600',
                    color: '#4a5568',
                    borderBottom: '2px solid #e2e8f0'
                  }}>Exit Method</th>
                  <th style={{ 
                    padding: '1rem',
                    textAlign: 'left',
                    fontWeight: '600',
                    color: '#4a5568',
                    borderBottom: '2px solid #e2e8f0'
                  }}>Early Leave</th>
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
                    <td style={{ padding: '1rem', color: '#718096', textAlign: 'center' }}>
                      {formatTimestamp(record.joinedAt)}
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
                          record.entryStatus === EntryStatus.PRESENT_ENTRY ? '#c6f6d5' :
                          record.entryStatus === EntryStatus.LATE_ENTRY ? '#fed7d7' :
                          '#e2e8f0',
                        color:
                          record.entryStatus === EntryStatus.PRESENT_ENTRY ? '#22543d' :
                          record.entryStatus === EntryStatus.LATE_ENTRY ? '#742a2a' :
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
                          ⚠️ Out of bounds
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
                    <td style={{ padding: '1rem', color: '#718096' }}>
                      {formatTimestamp(record.exitedAt)}
                    </td>
                    <td style={{ padding: '1rem', textAlign: 'center' }}>
                      {record.exitMethod ? (
                        <span style={{
                          padding: '0.25rem 0.5rem',
                          backgroundColor: record.exitMethod === 'CHAIN' ? '#e0f2fe' : '#fef3c7',
                          color: record.exitMethod === 'CHAIN' ? '#075985' : '#92400e',
                          borderRadius: '8px',
                          fontSize: '0.75rem',
                          fontWeight: '600'
                        }}>
                          {record.exitMethod === 'CHAIN' ? '🔗 Chain' : '📱 QR'}
                        </span>
                      ) : (
                        <span style={{ color: '#a0aec0' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '1rem', color: '#718096' }}>
                      {record.earlyLeaveAt ? formatTimestamp(record.earlyLeaveAt) : '—'}
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
export const TeacherDashboard = React.memo(TeacherDashboardComponent);





