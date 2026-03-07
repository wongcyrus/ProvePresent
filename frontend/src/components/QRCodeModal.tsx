import React, { useState } from 'react';

interface QRCodeModalProps {
  sessionId: string;
  classId: string;
  type: 'ENTRY' | 'EXIT';
  qrDataUrl: string;
  studentUrl?: string; // URL to copy
  onClose: () => void;
}

export const QRCodeModal: React.FC<QRCodeModalProps> = ({
  sessionId,
  classId,
  type,
  qrDataUrl,
  studentUrl,
  onClose
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    console.log('QRCodeModal: handleCopy called');
    console.log('QRCodeModal: studentUrl prop:', studentUrl);
    console.log('QRCodeModal: studentUrl length:', studentUrl?.length);
    
    if (!studentUrl) {
      console.error('QRCodeModal: Cannot copy - studentUrl is missing');
      alert('Cannot copy URL - missing student URL data');
      return;
    }
    
    try {
      // Try modern clipboard API first
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(studentUrl);
      } else {
        // Fallback for browsers without clipboard API or non-HTTPS
        const textArea = document.createElement('textarea');
        textArea.value = studentUrl;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        
        if (!successful) {
          throw new Error('Failed to copy using fallback method');
        }
      }
      
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
      // Show user-friendly error message
      alert('Failed to copy URL. Please manually copy: ' + studentUrl);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        backdropFilter: 'blur(4px)'
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: 'white',
          padding: '2.5rem',
          borderRadius: '20px',
          maxWidth: '500px',
          textAlign: 'center',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          animation: 'slideIn 0.3s ease-out'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ 
          fontSize: '3rem',
          marginBottom: '1rem'
        }}>
          {type === 'ENTRY' ? '📥' : '📤'}
        </div>
        <h2 style={{ 
          color: '#2d3748',
          marginTop: 0,
          marginBottom: '0.5rem',
          fontSize: '1.75rem'
        }}>
          {type === 'ENTRY' ? 'Entry QR Code' : 'Exit QR Code'}
        </h2>
        <h3 style={{ 
          color: '#4a5568',
          marginTop: 0,
          marginBottom: '1rem',
          fontSize: '1.25rem'
        }}>
          {classId}
        </h3>
        
        <div style={{
          display: 'inline-block',
          padding: '1.5rem',
          backgroundColor: type === 'ENTRY' ? '#e6ffed' : '#fff5e6',
          borderRadius: '16px',
          marginBottom: '1.5rem',
          border: `3px solid ${type === 'ENTRY' ? '#48bb78' : '#ed8936'}`
        }}>
          <img src={qrDataUrl} alt={`${type} QR Code`} style={{
            display: 'block',
            borderRadius: '8px'
          }} />
        </div>
        
        {/* Copy Button - Below QR Code */}
        {studentUrl ? (
          <div style={{ display: 'block', marginBottom: '1.5rem' }}>
            <button
              onClick={handleCopy}
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: copied ? '#28a745' : 'white',
                border: '2px solid #4a5568',
                borderRadius: '20px',
                cursor: 'pointer',
                fontSize: '0.95rem',
                fontWeight: '600',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                transition: 'all 0.2s',
                color: copied ? 'white' : '#2d3748',
                margin: '0 auto'
              }}
              onMouseOver={(e) => {
                if (!copied) {
                  e.currentTarget.style.transform = 'scale(1.05)';
                  e.currentTarget.style.backgroundColor = type === 'ENTRY' ? '#48bb78' : '#ed8936';
                  e.currentTarget.style.color = 'white';
                }
              }}
              onMouseOut={(e) => {
                if (!copied) {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'white';
                  e.currentTarget.style.color = '#2d3748';
                }
              }}
              title={copied ? 'Copied to clipboard!' : 'Copy student URL to clipboard'}
            >
              {copied ? '✓ Copied' : '📋 Copy URL'}
            </button>
          </div>
        ) : (
          <div style={{ 
            display: 'block', 
            marginBottom: '1.5rem',
            padding: '0.5rem',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '8px',
            color: '#dc2626',
            fontSize: '0.875rem'
          }}>
            ⚠️ URL not available for copying
          </div>
        )}
        <p style={{ 
          fontSize: '0.95rem', 
          color: '#4a5568', 
          margin: '0 0 1.5rem 0',
          lineHeight: '1.6'
        }}>
          {type === 'ENTRY' 
            ? 'Students scan this QR code to mark their entry'
            : 'Students scan this QR code to mark their exit'}
        </p>
        <button
          onClick={onClose}
          style={{
            padding: '0.875rem 2rem',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            color: 'white',
            border: 'none',
            borderRadius: '10px',
            cursor: 'pointer',
            fontSize: '1rem',
            fontWeight: '600',
            boxShadow: '0 4px 12px rgba(102, 126, 234, 0.3)',
            transition: 'all 0.2s'
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.transform = 'scale(1.05)';
            e.currentTarget.style.boxShadow = '0 6px 16px rgba(102, 126, 234, 0.4)';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.3)';
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
};
