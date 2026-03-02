/**
 * Tab Navigation Component for Teacher Dashboard
 */

import React from 'react';

export interface Tab {
  id: string;
  label: string;
  icon: string;
  badge?: number | string;
  badgeColor?: string;
}

interface TeacherDashboardTabsProps {
  activeTab: string;
  onTabChange: (tabId: string) => void;
  tabs: Tab[];
}

export const TeacherDashboardTabs: React.FC<TeacherDashboardTabsProps> = ({
  activeTab,
  onTabChange,
  tabs,
}) => {
  return (
    <div style={{
      backgroundColor: 'white',
      borderRadius: '12px',
      padding: '0.5rem',
      marginBottom: '1.5rem',
      boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
      display: 'flex',
      gap: '0.5rem',
      flexWrap: 'wrap',
      overflowX: 'auto'
    }}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          style={{
            flex: '1 1 auto',
            minWidth: '120px',
            padding: '0.875rem 1.25rem',
            backgroundColor: activeTab === tab.id ? '#667eea' : 'transparent',
            color: activeTab === tab.id ? 'white' : '#4a5568',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '0.95rem',
            fontWeight: '600',
            transition: 'all 0.2s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            position: 'relative'
          }}
          onMouseOver={(e) => {
            if (activeTab !== tab.id) {
              e.currentTarget.style.backgroundColor = '#f7fafc';
            }
          }}
          onMouseOut={(e) => {
            if (activeTab !== tab.id) {
              e.currentTarget.style.backgroundColor = 'transparent';
            }
          }}
        >
          <span style={{ fontSize: '1.2rem' }}>{tab.icon}</span>
          <span>{tab.label}</span>
          {tab.badge !== undefined && (
            <span style={{
              padding: '0.15rem 0.5rem',
              backgroundColor: tab.badgeColor || '#e53e3e',
              color: 'white',
              borderRadius: '10px',
              fontSize: '0.75rem',
              fontWeight: '700',
              minWidth: '20px',
              textAlign: 'center'
            }}>
              {tab.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
};
