/**
 * Student Capture UI Component
 * 
 * Handles student photo capture and upload workflow:
 * - Shows capture button only when capture request is active
 * - Requests camera access and captures photo
 * - Validates image size (≤1MB, compresses if needed)
 * - Uploads directly to Azure Blob Storage using SAS URL
 * - Notifies backend of completion
 * - Handles errors and timeouts
 * - Displays countdown timer (30 seconds)
 * 
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 5.1, 5.4
 */

import { useState, useEffect, useRef } from 'react';
import { getAuthHeaders } from '../utils/authHeaders';

interface StudentCaptureUIProps {
  sessionId: string;
  studentId: string;
  captureRequestId: string | null;
  sasUrl: string | null;
  expiresAt: number | null; // Unix timestamp in milliseconds
  onUploadComplete: () => void;
  onCaptureExpired: () => void;
}

export function StudentCaptureUI({
  sessionId,
  studentId,
  captureRequestId,
  sasUrl,
  expiresAt,
  onUploadComplete,
  onCaptureExpired
}: StudentCaptureUIProps) {
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [showCamera, setShowCamera] = useState(false);
  const [connectionWarning, setConnectionWarning] = useState<string | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => {
      setConnectionWarning(null);
    };

    const handleOffline = () => {
      setConnectionWarning('⚠️ Connection lost. Your upload may be delayed. Please stay on this page.');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Check initial status
    if (!navigator.onLine) {
      handleOffline();
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Calculate time remaining
  useEffect(() => {
    if (!expiresAt) {
      setTimeRemaining(0);
      return;
    }

    const updateTimer = () => {
      const now = Date.now();
      const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000));
      setTimeRemaining(remaining);

      if (remaining === 0) {
        onCaptureExpired();
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [expiresAt, onCaptureExpired]);

  // Cleanup camera stream when component unmounts or camera closes
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // Don't render if no active capture request
  if (!captureRequestId || !sasUrl || !expiresAt || timeRemaining === 0) {
    return null;
  }

  const startCamera = async () => {
    try {
      setErrorMessage(null);
      console.log('[Camera] Requesting camera access...');
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      
      console.log('[Camera] Stream obtained:', stream.getVideoTracks().length, 'video tracks');
      console.log('[Camera] Video track settings:', stream.getVideoTracks()[0]?.getSettings());
      streamRef.current = stream;
      
      // Set showCamera first to render the video element
      setShowCamera(true);
      
      // Wait for next tick to ensure video element is rendered
      await new Promise(resolve => setTimeout(resolve, 100));
      
      if (videoRef.current) {
        console.log('[Camera] Video element found, setting srcObject...');
        const video = videoRef.current;
        video.srcObject = stream;
        
        // Wait for video to be ready
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            console.error('[Camera] Timeout waiting for video metadata');
            reject(new Error('Video metadata timeout'));
          }, 5000);
          
          const onLoadedMetadata = () => {
            clearTimeout(timeout);
            console.log('[Camera] Video metadata loaded:', {
              videoWidth: video.videoWidth,
              videoHeight: video.videoHeight,
              readyState: video.readyState
            });
            video.removeEventListener('loadedmetadata', onLoadedMetadata);
            video.removeEventListener('error', onError);
            resolve();
          };
          
          const onError = (e: Event) => {
            clearTimeout(timeout);
            console.error('[Camera] Video error event:', e);
            video.removeEventListener('loadedmetadata', onLoadedMetadata);
            video.removeEventListener('error', onError);
            reject(new Error('Video failed to load'));
          };
          
          video.addEventListener('loadedmetadata', onLoadedMetadata);
          video.addEventListener('error', onError);
          
          // If metadata is already loaded, resolve immediately
          if (video.readyState >= 1) {
            console.log('[Camera] Video metadata already loaded');
            clearTimeout(timeout);
            onLoadedMetadata();
          }
        });
        
        console.log('[Camera] Starting video playback...');
        try {
          await video.play();
          console.log('[Camera] Video playing successfully');
        } catch (playError) {
          console.error('[Camera] Play error:', playError);
          throw playError;
        }
      } else {
        console.error('[Camera] Video element not found after render');
        throw new Error('Video element not available');
      }
      
      console.log('[Camera] Camera started successfully');
    } catch (err) {
      console.error('[Camera] Camera access error:', err);
      
      // Determine specific error message based on error type
      let errorMsg = 'Camera access is required to capture your photo. Please enable camera permissions in your browser settings.';
      
      if (err instanceof Error) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          errorMsg = 'Camera access denied. Please enable camera permissions in your browser settings and try again.';
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          errorMsg = 'No camera found. Please ensure your device has a camera connected.';
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          errorMsg = 'Camera is already in use by another application. Please close other apps using the camera and try again.';
        } else if (err.name === 'OverconstrainedError') {
          errorMsg = 'Camera does not meet requirements. Please try with a different camera.';
        } else if (err.message.includes('Video failed to load')) {
          errorMsg = 'Failed to initialize camera video. Please refresh the page and try again.';
        }
      }
      
      setErrorMessage(errorMsg);
      
      // Clean up stream if it was created
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setShowCamera(false);
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    // Set canvas dimensions to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    // Draw video frame to canvas
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Convert canvas to blob
    canvas.toBlob(async (blob) => {
      if (!blob) {
        setErrorMessage('Failed to capture photo. Please try again.');
        return;
      }

      // Validate and compress if needed
      const processedBlob = await validateAndCompressImage(blob);
      
      if (processedBlob) {
        setPhoto(processedBlob);
        setPhotoPreviewUrl(URL.createObjectURL(processedBlob));
        stopCamera();
      }
    }, 'image/jpeg', 0.85);
  };

  const validateAndCompressImage = async (blob: Blob): Promise<Blob | null> => {
    const maxSize = 1048576; // 1MB in bytes

    // If already under 1MB, return as-is
    if (blob.size <= maxSize) {
      return blob;
    }

    // Try to compress
    try {
      const compressed = await compressImage(blob, maxSize);
      
      if (compressed.size <= maxSize) {
        return compressed;
      } else {
        setErrorMessage('Image is too large. Please try again with lower quality or different camera.');
        return null;
      }
    } catch (err) {
      console.error('Compression error:', err);
      setErrorMessage('Failed to process image. Please try again.');
      return null;
    }
  };

  const compressImage = async (blob: Blob, maxSize: number): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      
      img.onload = () => {
        URL.revokeObjectURL(url);
        
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        // Scale down if too large
        const maxDimension = 1920;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = (height / width) * maxDimension;
            width = maxDimension;
          } else {
            width = (width / height) * maxDimension;
            height = maxDimension;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }
        
        ctx.drawImage(img, 0, 0, width, height);
        
        // Try different quality levels
        let quality = 0.7;
        const tryCompress = () => {
          canvas.toBlob((compressedBlob) => {
            if (!compressedBlob) {
              reject(new Error('Compression failed'));
              return;
            }
            
            if (compressedBlob.size <= maxSize || quality <= 0.3) {
              resolve(compressedBlob);
            } else {
              quality -= 0.1;
              tryCompress();
            }
          }, 'image/jpeg', quality);
        };
        
        tryCompress();
      };
      
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image'));
      };
      
      img.src = url;
    });
  };

  const uploadPhoto = async () => {
    if (!photo || !sasUrl || !captureRequestId) return;

    console.log('[Upload] Starting upload process...', {
      photoSize: photo.size,
      photoType: photo.type,
      captureRequestId,
      sasUrlLength: sasUrl.length
    });

    setUploadStatus('uploading');
    setErrorMessage(null);

    const attemptUpload = async (isRetry: boolean = false): Promise<boolean> => {
      try {
        console.log(`[Upload] ${isRetry ? 'Retry' : 'First'} attempt - uploading to blob storage...`);
        
        // Upload directly to blob storage
        const uploadResponse = await fetch(sasUrl, {
          method: 'PUT',
          headers: {
            'x-ms-blob-type': 'BlockBlob',
            'Content-Type': 'image/jpeg',
          },
          body: photo,
        });

        console.log('[Upload] Blob upload response:', {
          status: uploadResponse.status,
          statusText: uploadResponse.statusText,
          ok: uploadResponse.ok
        });

        if (!uploadResponse.ok) {
          const errorText = await uploadResponse.text();
          console.error('[Upload] Blob upload failed:', errorText);
          throw new Error(`Upload failed: ${uploadResponse.status} - ${errorText}`);
        }

        console.log('[Upload] Blob upload successful, notifying backend...');

        // Notify backend of completion
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || '/api';
        const headers = await getAuthHeaders();
        
        // Extract blob name from SAS URL
        const url = new URL(sasUrl);
        const blobName = decodeURIComponent(url.pathname.split('/').slice(2).join('/')); // Remove /container/ prefix and decode
        
        console.log('[Upload] Notifying backend:', {
          apiUrl,
          sessionId,
          captureRequestId,
          blobName
        });
        
        const notifyResponse = await fetch(
          `${apiUrl}/sessions/${sessionId}/capture/${captureRequestId}/upload`,
          {
            credentials: 'include',
            method: 'POST',
            headers,
            body: JSON.stringify({ blobName })
          }
        );

        console.log('[Upload] Backend notification response:', {
          status: notifyResponse.status,
          statusText: notifyResponse.statusText,
          ok: notifyResponse.ok
        });

        if (!notifyResponse.ok) {
          const errorData = await notifyResponse.json();
          console.error('[Upload] Backend notification failed:', errorData);
          throw new Error(errorData.error?.message || 'Failed to notify upload');
        }

        const responseData = await notifyResponse.json();
        console.log('[Upload] Backend notification successful:', responseData);

        setUploadStatus('success');
        
        // Clean up and notify parent
        setTimeout(() => {
          setPhoto(null);
          setPhotoPreviewUrl(null);
          onUploadComplete();
        }, 2000);

        return true;

      } catch (err) {
        console.error(`[Upload] ${isRetry ? 'Retry' : 'Attempt'} error:`, err);
        
        // Determine error message based on error type
        let errorMsg = 'Upload failed. Please check your connection and try again.';
        
        if (err instanceof Error) {
          console.error('[Upload] Error details:', {
            name: err.name,
            message: err.message,
            stack: err.stack
          });
          
          if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
            errorMsg = 'Network error. Please check your internet connection and try again.';
          } else if (err.message.includes('timeout')) {
            errorMsg = 'Upload timed out. Please try again.';
          } else if (err.message.includes('expired') || err.message.includes('Time expired')) {
            errorMsg = 'Time expired. The capture window has closed.';
          } else if (err.message.includes('403') || err.message.includes('401')) {
            errorMsg = 'Upload not authorized. The capture window may have expired.';
          } else {
            errorMsg = `Upload failed: ${err.message}`;
          }
        }
        
        setErrorMessage(errorMsg);
        return false;
      }
    };

    // First attempt
    const success = await attemptUpload(false);
    
    if (!success) {
      console.log('[Upload] First attempt failed, will retry in 2 seconds...');
      // Automatic retry after 2 seconds
      setTimeout(async () => {
        const retrySuccess = await attemptUpload(true);
        
        if (!retrySuccess) {
          console.log('[Upload] Retry also failed, setting error status');
          setUploadStatus('error');
          // Photo is kept in memory for manual retry
        }
      }, 2000);
    }
  };

  const manualRetryUpload = async () => {
    if (!photo || !sasUrl || !captureRequestId) return;
    
    setUploadStatus('uploading');
    setErrorMessage(null);
    
    await uploadPhoto();
  };

  const retakePhoto = () => {
    setPhoto(null);
    if (photoPreviewUrl) {
      URL.revokeObjectURL(photoPreviewUrl);
      setPhotoPreviewUrl(null);
    }
    setUploadStatus('idle');
    setErrorMessage(null);
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2000,
      padding: '1rem'
    }}>
      <div style={{
        backgroundColor: 'white',
        borderRadius: '12px',
        padding: '1.5rem',
        maxWidth: '500px',
        width: '100%',
        maxHeight: '90vh',
        overflow: 'auto'
      }}>
        {/* Header with Timer */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1rem',
          paddingBottom: '1rem',
          borderBottom: '2px solid #e0e0e0'
        }}>
          <h2 style={{ margin: 0, fontSize: '1.3rem', color: '#333' }}>
            📸 Capture Photo
          </h2>
          <div style={{
            padding: '0.5rem 1rem',
            backgroundColor: timeRemaining <= 5 ? '#dc3545' : timeRemaining <= 10 ? '#ffc107' : '#28a745',
            color: 'white',
            borderRadius: '20px',
            fontWeight: 'bold',
            fontSize: '1rem',
            minWidth: '80px',
            textAlign: 'center'
          }}>
            ⏱️ {timeRemaining}s
          </div>
        </div>

        {/* Connection Warning */}
        {connectionWarning && (
          <div style={{
            padding: '0.75rem 1rem',
            backgroundColor: '#fff3cd',
            color: '#856404',
            border: '1px solid #ffeaa7',
            borderRadius: '8px',
            marginBottom: '1rem',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            {connectionWarning}
          </div>
        )}

        {/* Error Message */}
        {errorMessage && (
          <div style={{
            padding: '1rem',
            backgroundColor: '#f8d7da',
            color: '#721c24',
            border: '1px solid #f5c6cb',
            borderRadius: '8px',
            marginBottom: '1rem',
            fontSize: '0.9rem'
          }}>
            <div style={{ marginBottom: '0.5rem' }}>{errorMessage}</div>
            {errorMessage.includes('camera permissions') && (
              <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  onClick={startCamera}
                  style={{
                    padding: '0.5rem 1rem',
                    backgroundColor: '#007bff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    fontWeight: '600'
                  }}
                >
                  🔄 Retry
                </button>
                <a
                  href="https://support.google.com/chrome/answer/2693767"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: '0.5rem 1rem',
                    backgroundColor: '#6c757d',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '0.85rem',
                    textDecoration: 'none',
                    display: 'inline-block',
                    fontWeight: '600'
                  }}
                >
                  📖 Help
                </a>
              </div>
            )}
          </div>
        )}

        {/* Success Message */}
        {uploadStatus === 'success' && (
          <div style={{
            padding: '1rem',
            backgroundColor: '#d4edda',
            color: '#155724',
            border: '1px solid #c3e6cb',
            borderRadius: '8px',
            marginBottom: '1rem',
            fontSize: '0.9rem',
            textAlign: 'center'
          }}>
            ✓ Photo uploaded successfully!
          </div>
        )}

        {/* Camera View */}
        {showCamera && !photo && (
          <div style={{ 
            marginBottom: '1rem',
            position: 'relative',
            backgroundColor: '#000',
            borderRadius: '8px',
            overflow: 'hidden'
          }}>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{
                width: '100%',
                height: 'auto',
                minHeight: '300px',
                maxHeight: '500px',
                borderRadius: '8px',
                backgroundColor: '#000',
                display: 'block',
                objectFit: 'cover',
                transform: 'scaleX(-1)' // Mirror the video for selfie mode
              }}
            />
            {/* Loading indicator while video initializes */}
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              color: 'white',
              fontSize: '1rem',
              pointerEvents: 'none'
            }}>
              {videoRef.current?.readyState === 0 && '⏳ Initializing camera...'}
            </div>
            <canvas ref={canvasRef} style={{ display: 'none' }} />
            
            <div style={{
              display: 'flex',
              gap: '0.5rem',
              marginTop: '1rem'
            }}>
              <button
                onClick={capturePhoto}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  backgroundColor: '#007bff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '1rem',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                📷 Capture
              </button>
              <button
                onClick={stopCamera}
                style={{
                  padding: '0.75rem 1.5rem',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '1rem',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Photo Preview */}
        {photo && photoPreviewUrl && (
          <div style={{ marginBottom: '1rem' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoPreviewUrl}
              alt="Captured photo"
              style={{
                width: '100%',
                borderRadius: '8px',
                marginBottom: '1rem'
              }}
            />
            
            <div style={{
              display: 'flex',
              gap: '0.5rem'
            }}>
              {uploadStatus === 'error' ? (
                <>
                  <button
                    onClick={manualRetryUpload}
                    style={{
                      flex: 1,
                      padding: '0.75rem',
                      backgroundColor: '#ffc107',
                      color: '#000',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '1rem',
                      fontWeight: 'bold',
                      cursor: 'pointer'
                    }}
                  >
                    🔄 Retry Upload
                  </button>
                  <button
                    onClick={retakePhoto}
                    style={{
                      padding: '0.75rem 1.5rem',
                      backgroundColor: '#6c757d',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '1rem',
                      cursor: 'pointer'
                    }}
                  >
                    Retake
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={uploadPhoto}
                    disabled={uploadStatus === 'uploading' || uploadStatus === 'success'}
                    style={{
                      flex: 1,
                      padding: '0.75rem',
                      backgroundColor: uploadStatus === 'uploading' ? '#6c757d' : '#28a745',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '1rem',
                      fontWeight: 'bold',
                      cursor: uploadStatus === 'uploading' ? 'not-allowed' : 'pointer',
                      opacity: uploadStatus === 'uploading' ? 0.7 : 1
                    }}
                  >
                    {uploadStatus === 'uploading' ? '⏳ Uploading...' : '✓ Upload Photo'}
                  </button>
                  <button
                    onClick={retakePhoto}
                    disabled={uploadStatus === 'uploading' || uploadStatus === 'success'}
                    style={{
                      padding: '0.75rem 1.5rem',
                      backgroundColor: '#6c757d',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '1rem',
                      cursor: uploadStatus === 'uploading' ? 'not-allowed' : 'pointer',
                      opacity: uploadStatus === 'uploading' ? 0.7 : 1
                    }}
                  >
                    Retake
                  </button>
                </>
              )}
            </div>
            
            <div style={{
              marginTop: '0.5rem',
              fontSize: '0.85rem',
              color: '#666',
              textAlign: 'center'
            }}>
              Photo size: {(photo.size / 1024).toFixed(0)} KB
            </div>
          </div>
        )}

        {/* Initial Capture Button */}
        {!showCamera && !photo && (
          <div>
            <p style={{
              color: '#666',
              marginBottom: '1rem',
              fontSize: '0.95rem',
              lineHeight: '1.5'
            }}>
              Your teacher has requested a photo. Please capture a photo showing your view of the classroom.
            </p>
            
            <button
              onClick={startCamera}
              disabled={uploadStatus === 'success'}
              style={{
                width: '100%',
                padding: '1rem',
                backgroundColor: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '1.1rem',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              📷 Start Camera
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
