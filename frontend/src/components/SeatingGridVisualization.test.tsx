/**
 * Unit tests for SeatingGridVisualization component
 * 
 * Tests:
 * - Grid rendering with various position configurations
 * - Confidence level styling
 * - Empty state (no positions)
 * - Cell click interactions
 * - Detail popup display
 * 
 * Validates: Requirements 6.2, 6.3
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SeatingGridVisualization } from './SeatingGridVisualization';
import type { SeatingPosition } from '../../../backend/src/types/studentImageCapture';

describe('SeatingGridVisualization', () => {
  const mockPositions: SeatingPosition[] = [
    {
      studentId: 'student1@stu.vtc.edu.hk',
      estimatedRow: 1,
      estimatedColumn: 1,
      confidence: 'HIGH',
      reasoning: 'Clear projector visibility, centered position'
    },
    {
      studentId: 'student2@stu.vtc.edu.hk',
      estimatedRow: 1,
      estimatedColumn: 2,
      confidence: 'MEDIUM',
      reasoning: 'Partial projector visibility'
    },
    {
      studentId: 'student3@stu.vtc.edu.hk',
      estimatedRow: 2,
      estimatedColumn: 1,
      confidence: 'LOW',
      reasoning: 'Limited visibility, estimated from angle'
    }
  ];

  describe('Empty State', () => {
    it('should display empty state message when no positions provided', () => {
      render(<SeatingGridVisualization positions={[]} />);
      expect(screen.getByText('No seating positions available')).toBeInTheDocument();
    });

    it('should display empty state message when positions is null', () => {
      render(<SeatingGridVisualization positions={null as any} />);
      expect(screen.getByText('No seating positions available')).toBeInTheDocument();
    });
  });

  describe('Grid Rendering', () => {
    it('should render grid with correct dimensions', () => {
      const { container } = render(<SeatingGridVisualization positions={mockPositions} />);
      
      // Check header shows correct dimensions
      expect(screen.getByText(/2 rows × 2 columns/)).toBeInTheDocument();
      
      // Check grid container exists
      const gridContainer = container.querySelector('[style*="display: grid"]');
      expect(gridContainer).toBeInTheDocument();
    });

    it('should display student count in header', () => {
      render(<SeatingGridVisualization positions={mockPositions} />);
      expect(screen.getByText(/3 students/)).toBeInTheDocument();
    });

    it('should display front of classroom indicator', () => {
      render(<SeatingGridVisualization positions={mockPositions} />);
      expect(screen.getByText(/Front of Classroom \(Projector\)/)).toBeInTheDocument();
    });

    it('should render all student positions', () => {
      render(<SeatingGridVisualization positions={mockPositions} />);
      
      // Check that student IDs are displayed (shortened)
      expect(screen.getByText(/student1/)).toBeInTheDocument();
      expect(screen.getByText(/student2/)).toBeInTheDocument();
      expect(screen.getByText(/student3/)).toBeInTheDocument();
    });

    it('should render empty cells for unoccupied positions', () => {
      render(<SeatingGridVisualization positions={mockPositions} />);
      
      // Position (2,2) should be empty
      expect(screen.getByText('R2C2')).toBeInTheDocument();
    });
  });

  describe('Confidence Level Styling', () => {
    it('should display legend with all confidence levels', () => {
      render(<SeatingGridVisualization positions={mockPositions} />);
      
      expect(screen.getByText('High')).toBeInTheDocument();
      expect(screen.getByText('Medium')).toBeInTheDocument();
      expect(screen.getByText('Low')).toBeInTheDocument();
    });

    it('should apply correct border colors based on confidence', () => {
      const { container } = render(<SeatingGridVisualization positions={mockPositions} />);
      
      // Check that cells with different confidence levels have different colored borders
      // We'll verify by checking the inline styles contain the expected colors
      const htmlContent = container.innerHTML;
      
      // HIGH confidence should have green border (#48bb78)
      expect(htmlContent).toContain('#48bb78');
      
      // MEDIUM confidence should have orange border (#ed8936)
      expect(htmlContent).toContain('#ed8936');
      
      // LOW confidence should have red border (#e53e3e)
      expect(htmlContent).toContain('#e53e3e');
    });
  });

  describe('Cell Interactions', () => {
    it('should open detail popup when clicking on occupied cell', () => {
      render(<SeatingGridVisualization positions={mockPositions} />);
      
      // Click on student1 cell
      const student1Cell = screen.getByText(/student1/).closest('div');
      fireEvent.click(student1Cell!);
      
      // Check that detail popup appears with full student ID
      expect(screen.getByText('student1@stu.vtc.edu.hk')).toBeInTheDocument();
    });

    it('should display position details in popup', () => {
      render(<SeatingGridVisualization positions={mockPositions} />);
      
      // Click on student1 cell
      const student1Cell = screen.getByText(/student1/).closest('div');
      fireEvent.click(student1Cell!);
      
      // Check position details - use getAllByText since there are multiple "1"s
      expect(screen.getByText('Row')).toBeInTheDocument();
      expect(screen.getByText('Column')).toBeInTheDocument();
      const rowValues = screen.getAllByText('1');
      expect(rowValues.length).toBeGreaterThan(0); // At least one "1" should be present
    });

    it('should display confidence level in popup', () => {
      render(<SeatingGridVisualization positions={mockPositions} />);
      
      // Click on student1 cell
      const student1Cell = screen.getByText(/student1/).closest('div');
      fireEvent.click(student1Cell!);
      
      // Check confidence level
      expect(screen.getByText('Confidence Level')).toBeInTheDocument();
      expect(screen.getByText('HIGH')).toBeInTheDocument();
    });

    it('should display reasoning in popup', () => {
      render(<SeatingGridVisualization positions={mockPositions} />);
      
      // Click on student1 cell
      const student1Cell = screen.getByText(/student1/).closest('div');
      fireEvent.click(student1Cell!);
      
      // Check reasoning
      expect(screen.getByText('Analysis Reasoning')).toBeInTheDocument();
      expect(screen.getByText('Clear projector visibility, centered position')).toBeInTheDocument();
    });

    it('should close popup when clicking backdrop', () => {
      render(<SeatingGridVisualization positions={mockPositions} />);
      
      // Open popup
      const student1Cell = screen.getByText(/student1/).closest('div');
      fireEvent.click(student1Cell!);
      
      // Verify popup is open
      expect(screen.getByText('student1@stu.vtc.edu.hk')).toBeInTheDocument();
      
      // Click backdrop (the fixed overlay)
      const backdrop = document.querySelector('[style*="position: fixed"][style*="rgba(0, 0, 0, 0.3)"]');
      fireEvent.click(backdrop!);
      
      // Verify popup is closed (full email should not be visible)
      expect(screen.queryByText('student1@stu.vtc.edu.hk')).not.toBeInTheDocument();
    });

    it('should close popup when clicking close button', () => {
      render(<SeatingGridVisualization positions={mockPositions} />);
      
      // Open popup
      const student1Cell = screen.getByText(/student1/).closest('div');
      fireEvent.click(student1Cell!);
      
      // Verify popup is open
      expect(screen.getByText('student1@stu.vtc.edu.hk')).toBeInTheDocument();
      
      // Click close button (×)
      const closeButton = screen.getByText('×');
      fireEvent.click(closeButton);
      
      // Verify popup is closed
      expect(screen.queryByText('student1@stu.vtc.edu.hk')).not.toBeInTheDocument();
    });

    it('should not open popup when clicking empty cell', () => {
      render(<SeatingGridVisualization positions={mockPositions} />);
      
      // Click on empty cell (R2C2)
      const emptyCell = screen.getByText('R2C2').closest('div');
      fireEvent.click(emptyCell!);
      
      // Verify no popup appears (check for backdrop)
      const backdrop = document.querySelector('[style*="position: fixed"][style*="rgba(0, 0, 0, 0.3)"]');
      expect(backdrop).not.toBeInTheDocument();
    });
  });

  describe('Grid Layout', () => {
    it('should handle single row layout', () => {
      const singleRowPositions: SeatingPosition[] = [
        {
          studentId: 'student1@stu.vtc.edu.hk',
          estimatedRow: 1,
          estimatedColumn: 1,
          confidence: 'HIGH',
          reasoning: 'Test'
        },
        {
          studentId: 'student2@stu.vtc.edu.hk',
          estimatedRow: 1,
          estimatedColumn: 2,
          confidence: 'HIGH',
          reasoning: 'Test'
        }
      ];

      render(<SeatingGridVisualization positions={singleRowPositions} />);
      expect(screen.getByText(/1 row × 2 columns/)).toBeInTheDocument();
    });

    it('should handle single column layout', () => {
      const singleColumnPositions: SeatingPosition[] = [
        {
          studentId: 'student1@stu.vtc.edu.hk',
          estimatedRow: 1,
          estimatedColumn: 1,
          confidence: 'HIGH',
          reasoning: 'Test'
        },
        {
          studentId: 'student2@stu.vtc.edu.hk',
          estimatedRow: 2,
          estimatedColumn: 1,
          confidence: 'HIGH',
          reasoning: 'Test'
        }
      ];

      render(<SeatingGridVisualization positions={singleColumnPositions} />);
      expect(screen.getByText(/2 rows × 1 column/)).toBeInTheDocument();
    });

    it('should handle large grid layout', () => {
      const largeGridPositions: SeatingPosition[] = [];
      for (let row = 1; row <= 5; row++) {
        for (let col = 1; col <= 5; col++) {
          largeGridPositions.push({
            studentId: `student${row}${col}@stu.vtc.edu.hk`,
            estimatedRow: row,
            estimatedColumn: col,
            confidence: 'HIGH',
            reasoning: 'Test'
          });
        }
      }

      render(<SeatingGridVisualization positions={largeGridPositions} />);
      expect(screen.getByText(/25 students • 5 rows × 5 columns/)).toBeInTheDocument();
    });
  });

  describe('Student ID Display', () => {
    it('should truncate long student IDs in grid cells', () => {
      const longIdPositions: SeatingPosition[] = [
        {
          studentId: 'verylongstudentidentifier@stu.vtc.edu.hk',
          estimatedRow: 1,
          estimatedColumn: 1,
          confidence: 'HIGH',
          reasoning: 'Test'
        }
      ];

      render(<SeatingGridVisualization positions={longIdPositions} />);
      
      // Should show truncated version with ellipsis
      expect(screen.getByText(/verylongstudent\.\.\./)).toBeInTheDocument();
    });

    it('should show full student ID in detail popup', () => {
      const longIdPositions: SeatingPosition[] = [
        {
          studentId: 'verylongstudentidentifier@stu.vtc.edu.hk',
          estimatedRow: 1,
          estimatedColumn: 1,
          confidence: 'HIGH',
          reasoning: 'Test'
        }
      ];

      render(<SeatingGridVisualization positions={longIdPositions} />);
      
      // Click cell to open popup
      const cell = screen.getByText(/verylongstudent/).closest('div');
      fireEvent.click(cell!);
      
      // Should show full ID in popup
      expect(screen.getByText('verylongstudentidentifier@stu.vtc.edu.hk')).toBeInTheDocument();
    });
  });
});
