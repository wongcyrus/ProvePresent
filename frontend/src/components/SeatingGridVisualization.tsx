/**
 * Seating Grid Visualization Component
 * 
 * Displays estimated student seating positions in a grid layout.
 * Provides an alternative visualization to the list format in TeacherCaptureControl.
 * 
 * Features:
 * - Grid layout based on max row and column from positions
 * - Color-coded borders for confidence levels (HIGH=green, MEDIUM=yellow, LOW=red)
 * - Hover/click to show studentId, confidence level, and reasoning
 * - Empty cells for unoccupied positions
 * 
 * Validates: Requirements 6.2, 6.3
 */

import { useState } from 'react';
import { formatStudentId } from '../utils/formatStudentId';
import type { SeatingPosition } from '../../../backend/src/types/studentImageCapture';

interface SeatingGridVisualizationProps {
  positions: SeatingPosition[];
  imageUrls?: Map<string, string>; // Map of studentId to image URL
}

interface SelectedPosition {
  position: SeatingPosition;
  x: number;
  y: number;
  imageUrl?: string;
}

export const SeatingGridVisualization: React.FC<SeatingGridVisualizationProps> = ({ positions, imageUrls }) => {
  const [selectedPosition, setSelectedPosition] = useState<SelectedPosition | null>(null);
  const [enlargedImage, setEnlargedImage] = useState<string | null>(null);
  const [showFullScreenGrid, setShowFullScreenGrid] = useState(false);

  // Handle empty positions array
  if (!positions || positions.length === 0) {
    return (
      <div style={{
        padding: '2rem',
        textAlign: 'center',
        backgroundColor: '#f7fafc',
        borderRadius: '8px',
        border: '2px dashed #cbd5e0',
        color: '#718096'
      }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📍</div>
        <div style={{ fontSize: '0.95rem' }}>No seating positions available</div>
      </div>
    );
  }

  // Calculate grid dimensions
  const maxRow = Math.max(...positions.map(p => p.estimatedRow));
  const maxColumn = Math.max(...positions.map(p => p.estimatedColumn));
  const totalStudents = positions.length;

  // Determine if we should show compact view (for large classes)
  const isLargeClass = totalStudents > 30;

  // Create a map for quick position lookup
  const positionMap = new Map<string, SeatingPosition>();
  positions.forEach(pos => {
    const key = `${pos.estimatedRow}-${pos.estimatedColumn}`;
    positionMap.set(key, pos);
  });

  // Get confidence color
  const getConfidenceColor = (confidence: string): string => {
    switch (confidence) {
      case 'HIGH':
        return '#48bb78'; // green
      case 'MEDIUM':
        return '#ed8936'; // yellow/orange
      case 'LOW':
        return '#e53e3e'; // red
      default:
        return '#a0aec0'; // gray
    }
  };

  // Get confidence background color (lighter version)
  const getConfidenceBackground = (confidence: string): string => {
    switch (confidence) {
      case 'HIGH':
        return '#c6f6d5'; // light green
      case 'MEDIUM':
        return '#fef3c7'; // light yellow
      case 'LOW':
        return '#fed7d7'; // light red
      default:
        return '#e2e8f0'; // light gray
    }
  };

  // Handle cell click
  const handleCellClick = (position: SeatingPosition | null, row: number, col: number, event: React.MouseEvent) => {
    if (position) {
      const imageUrl = imageUrls?.get(position.studentId);
      setSelectedPosition({
        position,
        x: event.clientX,
        y: event.clientY,
        imageUrl
      });
    } else {
      setSelectedPosition(null);
    }
  };

  // Close detail popup
  const closeDetail = () => {
    setSelectedPosition(null);
  };

  // Handle image click to enlarge
  const handleImageClick = (imageUrl: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setEnlargedImage(imageUrl);
  };

  // Close enlarged image
  const closeEnlargedImage = () => {
    setEnlargedImage(null);
  };

  return (
    <div style={{ position: 'relative' }}>
      {/* Compact Summary for Large Classes */}
      {isLargeClass && (
        <div style={{
          padding: '1.5rem',
          backgroundColor: '#f7fafc',
          borderRadius: '8px',
          border: '2px solid #e2e8f0',
          textAlign: 'center'
        }}>
          <div style={{
            fontSize: '3rem',
            marginBottom: '0.5rem'
          }}>
            🏫
          </div>
          <div style={{
            fontSize: '1.25rem',
            fontWeight: 'bold',
            color: '#2d3748',
            marginBottom: '0.5rem'
          }}>
            {totalStudents} Students
          </div>
          <div style={{
            fontSize: '0.9rem',
            color: '#718096',
            marginBottom: '1rem'
          }}>
            {maxRow} rows × {maxColumn} columns
          </div>
          <button
            onClick={() => setShowFullScreenGrid(true)}
            style={{
              padding: '0.75rem 2rem',
              backgroundColor: '#4299e1',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '1rem',
              fontWeight: '600',
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(66, 153, 225, 0.3)',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#3182ce';
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(66, 153, 225, 0.4)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#4299e1';
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(66, 153, 225, 0.3)';
            }}
          >
            📋 View Full Seating Plan
          </button>
        </div>
      )}

      {/* Regular Grid View for Small/Medium Classes */}
      {!isLargeClass && (
        <>
          {/* Grid Header */}
          <div style={{
            marginBottom: '1rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div>
              <h4 style={{
                margin: '0 0 0.25rem 0',
                fontSize: '1rem',
                color: '#333'
              }}>
                Seating Grid Visualization
              </h4>
              <div style={{
                fontSize: '0.85rem',
                color: '#666'
              }}>
                {positions.length} student{positions.length !== 1 ? 's' : ''} • {maxRow} row{maxRow !== 1 ? 's' : ''} × {maxColumn} column{maxColumn !== 1 ? 's' : ''}
              </div>
            </div>

            {/* Legend */}
            <div style={{
              display: 'flex',
              gap: '0.75rem',
              fontSize: '0.75rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <div style={{
                  width: '12px',
                  height: '12px',
                  backgroundColor: getConfidenceColor('HIGH'),
                  borderRadius: '2px'
                }} />
                <span style={{ color: '#666' }}>High</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <div style={{
                  width: '12px',
                  height: '12px',
                  backgroundColor: getConfidenceColor('MEDIUM'),
                  borderRadius: '2px'
                }} />
                <span style={{ color: '#666' }}>Medium</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <div style={{
                  width: '12px',
                  height: '12px',
                  backgroundColor: getConfidenceColor('LOW'),
                  borderRadius: '2px'
                }} />
                <span style={{ color: '#666' }}>Low</span>
              </div>
            </div>
          </div>

          {/* Front of classroom indicator */}
          <div style={{
            textAlign: 'center',
            marginBottom: '0.5rem',
            padding: '0.5rem',
            backgroundColor: '#edf2f7',
            borderRadius: '6px',
            fontSize: '0.85rem',
            fontWeight: '600',
            color: '#4a5568',
            border: '2px solid #cbd5e0'
          }}>
            🖥️ Front of Classroom (Projector)
          </div>

          {/* Grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${maxColumn}, 1fr)`,
            gap: '0.5rem',
            padding: '1rem',
            backgroundColor: '#f7fafc',
            borderRadius: '8px',
            border: '2px solid #e2e8f0'
          }}>
            {Array.from({ length: maxRow }, (_, rowIndex) => {
              const row = rowIndex + 1;
              return Array.from({ length: maxColumn }, (_, colIndex) => {
                const col = colIndex + 1;
                const key = `${row}-${col}`;
                const position = positionMap.get(key);

                return (
                  <div
                    key={key}
                    onClick={(e) => handleCellClick(position || null, row, col, e)}
                    style={{
                      aspectRatio: '1',
                      minHeight: '80px',
                      padding: '0.5rem',
                      backgroundColor: position ? getConfidenceBackground(position.confidence) : 'white',
                      border: position 
                        ? `3px solid ${getConfidenceColor(position.confidence)}`
                        : '2px dashed #cbd5e0',
                      borderRadius: '8px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: position ? 'pointer' : 'default',
                      transition: 'all 0.2s',
                      position: 'relative'
                    }}
                    onMouseEnter={(e) => {
                      if (position) {
                        e.currentTarget.style.transform = 'scale(1.05)';
                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (position) {
                        e.currentTarget.style.transform = 'scale(1)';
                        e.currentTarget.style.boxShadow = 'none';
                      }
                    }}
                  >
                    {position ? (
                      <>
                        {/* Student Photo Thumbnail or Icon */}
                        {imageUrls?.get(position.studentId) ? (
                          <div style={{
                            width: '50px',
                            height: '50px',
                            borderRadius: '50%',
                            overflow: 'hidden',
                            marginBottom: '0.25rem',
                            border: '2px solid white',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                          }}>
                            <img
                              src={imageUrls.get(position.studentId)}
                              alt={formatStudentId(position.studentId)}
                              style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover'
                              }}
                            />
                          </div>
                        ) : (
                          <div style={{
                            fontSize: '1.5rem',
                            marginBottom: '0.25rem'
                          }}>
                            👤
                          </div>
                        )}
                        
                        {/* Student ID (shortened) */}
                        <div style={{
                          fontSize: '0.75rem',
                          fontWeight: '600',
                          color: '#2d3748',
                          textAlign: 'center',
                          wordBreak: 'break-word',
                          lineHeight: '1.2'
                        }}>
                          {formatStudentId(position.studentId).substring(0, 15)}
                          {formatStudentId(position.studentId).length > 15 ? '...' : ''}
                        </div>

                        {/* Position label */}
                        <div style={{
                          fontSize: '0.65rem',
                          color: '#718096',
                          marginTop: '0.25rem'
                        }}>
                          R{row}C{col}
                        </div>
                      </>
                    ) : (
                      <>
                        {/* Empty cell */}
                        <div style={{
                          fontSize: '0.7rem',
                          color: '#cbd5e0'
                        }}>
                          R{row}C{col}
                        </div>
                      </>
                    )}
                  </div>
                );
              });
            })}
          </div>
        </>
      )}

      {/* Full-Screen Grid Modal for Large Classes */}
      {showFullScreenGrid && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setShowFullScreenGrid(false)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              zIndex: 999
            }}
          />

          {/* Full-Screen Modal */}
          <div
            style={{
              position: 'fixed',
              top: '2rem',
              left: '2rem',
              right: '2rem',
              bottom: '2rem',
              backgroundColor: 'white',
              borderRadius: '12px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
              zIndex: 1000,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden'
            }}
          >
            {/* Modal Header */}
            <div style={{
              padding: '1.5rem',
              borderBottom: '2px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: '#f7fafc'
            }}>
              <div>
                <h3 style={{
                  margin: '0 0 0.25rem 0',
                  fontSize: '1.25rem',
                  color: '#2d3748'
                }}>
                  Seating Plan
                </h3>
                <div style={{
                  fontSize: '0.9rem',
                  color: '#718096'
                }}>
                  {totalStudents} students • {maxRow} rows × {maxColumn} columns
                </div>
              </div>

              {/* Legend */}
              <div style={{
                display: 'flex',
                gap: '1rem',
                fontSize: '0.85rem',
                marginRight: '3rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div style={{
                    width: '16px',
                    height: '16px',
                    backgroundColor: getConfidenceColor('HIGH'),
                    borderRadius: '3px'
                  }} />
                  <span style={{ color: '#666' }}>High Confidence</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div style={{
                    width: '16px',
                    height: '16px',
                    backgroundColor: getConfidenceColor('MEDIUM'),
                    borderRadius: '3px'
                  }} />
                  <span style={{ color: '#666' }}>Medium</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div style={{
                    width: '16px',
                    height: '16px',
                    backgroundColor: getConfidenceColor('LOW'),
                    borderRadius: '3px'
                  }} />
                  <span style={{ color: '#666' }}>Low</span>
                </div>
              </div>

              {/* Close button */}
              <button
                onClick={() => setShowFullScreenGrid(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '2rem',
                  cursor: 'pointer',
                  color: '#718096',
                  padding: '0.25rem',
                  lineHeight: 1,
                  transition: 'color 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = '#2d3748'}
                onMouseLeave={(e) => e.currentTarget.style.color = '#718096'}
              >
                ×
              </button>
            </div>

            {/* Front of classroom indicator */}
            <div style={{
              padding: '0.75rem',
              textAlign: 'center',
              backgroundColor: '#edf2f7',
              borderBottom: '2px solid #cbd5e0',
              fontSize: '0.9rem',
              fontWeight: '600',
              color: '#4a5568'
            }}>
              🖥️ Front of Classroom (Projector)
            </div>

            {/* Scrollable Grid Content */}
            <div style={{
              flex: 1,
              overflow: 'auto',
              padding: '2rem',
              backgroundColor: '#f7fafc'
            }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${maxColumn}, minmax(100px, 1fr))`,
                gap: '0.75rem',
                maxWidth: '100%'
              }}>
                {Array.from({ length: maxRow }, (_, rowIndex) => {
                  const row = rowIndex + 1;
                  return Array.from({ length: maxColumn }, (_, colIndex) => {
                    const col = colIndex + 1;
                    const key = `${row}-${col}`;
                    const position = positionMap.get(key);

                    return (
                      <div
                        key={key}
                        onClick={(e) => {
                          if (position) {
                            handleCellClick(position, row, col, e);
                          }
                        }}
                        style={{
                          aspectRatio: '1',
                          minHeight: '100px',
                          padding: '0.75rem',
                          backgroundColor: position ? getConfidenceBackground(position.confidence) : 'white',
                          border: position 
                            ? `3px solid ${getConfidenceColor(position.confidence)}`
                            : '2px dashed #cbd5e0',
                          borderRadius: '10px',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: position ? 'pointer' : 'default',
                          transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => {
                          if (position) {
                            e.currentTarget.style.transform = 'scale(1.05)';
                            e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.15)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (position) {
                            e.currentTarget.style.transform = 'scale(1)';
                            e.currentTarget.style.boxShadow = 'none';
                          }
                        }}
                      >
                        {position ? (
                          <>
                            {/* Student Photo */}
                            {imageUrls?.get(position.studentId) ? (
                              <div style={{
                                width: '60px',
                                height: '60px',
                                borderRadius: '50%',
                                overflow: 'hidden',
                                marginBottom: '0.5rem',
                                border: '3px solid white',
                                boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
                              }}>
                                <img
                                  src={imageUrls.get(position.studentId)}
                                  alt={formatStudentId(position.studentId)}
                                  style={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'cover'
                                  }}
                                />
                              </div>
                            ) : (
                              <div style={{
                                fontSize: '2rem',
                                marginBottom: '0.5rem'
                              }}>
                                👤
                              </div>
                            )}
                            
                            {/* Student ID */}
                            <div style={{
                              fontSize: '0.8rem',
                              fontWeight: '600',
                              color: '#2d3748',
                              textAlign: 'center',
                              wordBreak: 'break-word',
                              lineHeight: '1.3',
                              maxWidth: '100%',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis'
                            }}>
                              {formatStudentId(position.studentId)}
                            </div>

                            {/* Position label */}
                            <div style={{
                              fontSize: '0.7rem',
                              color: '#718096',
                              marginTop: '0.25rem'
                            }}>
                              Row {row}, Col {col}
                            </div>
                          </>
                        ) : (
                          <div style={{
                            fontSize: '0.75rem',
                            color: '#cbd5e0'
                          }}>
                            R{row}C{col}
                          </div>
                        )}
                      </div>
                    );
                  });
                })}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Detail Popup */}
      {selectedPosition && (
        <>
          {/* Backdrop */}
          <div
            onClick={closeDetail}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.3)',
              zIndex: 999
            }}
          />

          {/* Popup */}
          <div
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              backgroundColor: 'white',
              padding: '1.5rem',
              borderRadius: '12px',
              boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
              maxWidth: '400px',
              width: '90%',
              zIndex: 1000,
              border: `3px solid ${getConfidenceColor(selectedPosition.position.confidence)}`
            }}
          >
            {/* Close button */}
            <button
              onClick={closeDetail}
              style={{
                position: 'absolute',
                top: '0.75rem',
                right: '0.75rem',
                background: 'none',
                border: 'none',
                fontSize: '1.5rem',
                cursor: 'pointer',
                color: '#718096',
                padding: '0.25rem',
                lineHeight: 1
              }}
            >
              ×
            </button>

            {/* Student Photo */}
            {selectedPosition.imageUrl && (
              <div style={{
                marginBottom: '1rem',
                textAlign: 'center'
              }}>
                <div
                  onClick={(e) => handleImageClick(selectedPosition.imageUrl!, e)}
                  style={{
                    width: '200px',
                    height: '200px',
                    margin: '0 auto',
                    borderRadius: '12px',
                    overflow: 'hidden',
                    border: `3px solid ${getConfidenceColor(selectedPosition.position.confidence)}`,
                    cursor: 'zoom-in',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                    transition: 'transform 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'scale(1.05)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                  }}
                >
                  <img
                    src={selectedPosition.imageUrl}
                    alt={formatStudentId(selectedPosition.position.studentId)}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover'
                    }}
                  />
                </div>
                <div style={{
                  fontSize: '0.75rem',
                  color: '#718096',
                  marginTop: '0.5rem'
                }}>
                  Click image to enlarge
                </div>
              </div>
            )}

            {/* Student info */}
            <div style={{
              marginBottom: '1rem'
            }}>
              <div style={{
                fontSize: '1.1rem',
                fontWeight: 'bold',
                color: '#2d3748',
                marginBottom: '0.5rem',
                paddingRight: '2rem'
              }}>
                {formatStudentId(selectedPosition.position.studentId)}
              </div>
              <div style={{
                fontSize: '0.85rem',
                color: '#718096'
              }}>
                {selectedPosition.position.studentId}
              </div>
            </div>

            {/* Position details */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '0.75rem',
              marginBottom: '1rem'
            }}>
              <div style={{
                padding: '0.75rem',
                backgroundColor: '#f7fafc',
                borderRadius: '6px'
              }}>
                <div style={{
                  fontSize: '0.75rem',
                  color: '#718096',
                  marginBottom: '0.25rem'
                }}>
                  Row
                </div>
                <div style={{
                  fontSize: '1.25rem',
                  fontWeight: 'bold',
                  color: '#2d3748'
                }}>
                  {selectedPosition.position.estimatedRow}
                </div>
              </div>
              <div style={{
                padding: '0.75rem',
                backgroundColor: '#f7fafc',
                borderRadius: '6px'
              }}>
                <div style={{
                  fontSize: '0.75rem',
                  color: '#718096',
                  marginBottom: '0.25rem'
                }}>
                  Column
                </div>
                <div style={{
                  fontSize: '1.25rem',
                  fontWeight: 'bold',
                  color: '#2d3748'
                }}>
                  {selectedPosition.position.estimatedColumn}
                </div>
              </div>
            </div>

            {/* Confidence */}
            <div style={{
              marginBottom: '1rem'
            }}>
              <div style={{
                fontSize: '0.75rem',
                color: '#718096',
                marginBottom: '0.5rem'
              }}>
                Confidence Level
              </div>
              <div style={{
                display: 'inline-block',
                padding: '0.5rem 1rem',
                backgroundColor: getConfidenceBackground(selectedPosition.position.confidence),
                color: getConfidenceColor(selectedPosition.position.confidence),
                borderRadius: '6px',
                fontSize: '0.9rem',
                fontWeight: 'bold',
                border: `2px solid ${getConfidenceColor(selectedPosition.position.confidence)}`
              }}>
                {selectedPosition.position.confidence}
              </div>
            </div>

            {/* Reasoning */}
            {selectedPosition.position.reasoning && (
              <div>
                <div style={{
                  fontSize: '0.75rem',
                  color: '#718096',
                  marginBottom: '0.5rem'
                }}>
                  Analysis Reasoning
                </div>
                <div style={{
                  padding: '0.75rem',
                  backgroundColor: '#f7fafc',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  color: '#4a5568',
                  lineHeight: '1.5',
                  fontStyle: 'italic'
                }}>
                  {selectedPosition.position.reasoning}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Enlarged Image Modal */}
      {enlargedImage && (
        <>
          {/* Backdrop */}
          <div
            onClick={closeEnlargedImage}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.9)',
              zIndex: 1001,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'zoom-out'
            }}
          >
            {/* Close button */}
            <button
              onClick={closeEnlargedImage}
              style={{
                position: 'absolute',
                top: '1rem',
                right: '1rem',
                background: 'white',
                border: 'none',
                fontSize: '2rem',
                cursor: 'pointer',
                color: '#2d3748',
                padding: '0.5rem 1rem',
                lineHeight: 1,
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                zIndex: 1002
              }}
            >
              ×
            </button>

            {/* Enlarged Image */}
            <img
              src={enlargedImage}
              alt="Enlarged student photo"
              onClick={(e) => e.stopPropagation()}
              style={{
                maxWidth: '90vw',
                maxHeight: '90vh',
                objectFit: 'contain',
                borderRadius: '12px',
                boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
                cursor: 'default'
              }}
            />

            {/* Hint text */}
            <div style={{
              position: 'absolute',
              bottom: '2rem',
              left: '50%',
              transform: 'translateX(-50%)',
              color: 'white',
              fontSize: '0.9rem',
              backgroundColor: 'rgba(0,0,0,0.7)',
              padding: '0.75rem 1.5rem',
              borderRadius: '8px'
            }}>
              Click anywhere to close
            </div>
          </div>
        </>
      )}
    </div>
  );
};
