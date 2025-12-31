import React, { useState } from 'react';
import { Fab, Tooltip } from '@mui/material';
import { BugReport as BugIcon } from '@mui/icons-material';
import BugReportDialog from './BugReportDialog';
import { CreateBugRequest } from '../../../src/shared/types/bugTracking';

interface BugReportButtonProps {
  projectId?: number;
  componentIds?: string[];
  position?: {
    bottom?: number;
    right?: number;
    top?: number;
    left?: number;
  };
}

const BugReportButton: React.FC<BugReportButtonProps> = ({
  projectId,
  componentIds,
  position = { bottom: 20, right: 20 }
}) => {
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleSubmitBugReport = async (bugReport: CreateBugRequest) => {
    try {
      const response = await fetch('/api/bugs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bugReport)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'バグレポートの送信に失敗しました');
      }

      // Show success message (you can customize this)
      console.log('Bug report submitted successfully');
      
      // You can add a toast notification here
      // toast.success('バグレポートが送信されました');
      
    } catch (error) {
      console.error('Failed to submit bug report:', error);
      throw error;
    }
  };

  return (
    <>
      <Tooltip title="バグを報告" placement="left">
        <Fab
          color="secondary"
          onClick={() => setDialogOpen(true)}
          sx={{
            position: 'fixed',
            ...position,
            zIndex: 1000
          }}
        >
          <BugIcon />
        </Fab>
      </Tooltip>
      
      <BugReportDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={handleSubmitBugReport}
        projectId={projectId}
        componentIds={componentIds}
      />
    </>
  );
};

export default BugReportButton;