import React, { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface ColumnResizeHandleProps {
  onResize: (deltaX: number) => void;
  isColumnBeingDragged?: boolean; // Disable resize when column is being dragged
}

/**
 * Resize handle component that allows users to drag and resize Kanban columns
 * Positioned between columns to adjust their width
 */
const ColumnResizeHandle: React.FC<ColumnResizeHandleProps> = ({ onResize, isColumnBeingDragged = false }) => {
  const { t } = useTranslation('tasks');
  const handleRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;

    const handleMouseDown = (e: MouseEvent) => {
      // Disable resize when a column is being dragged
      if (isColumnBeingDragged) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      isDraggingRef.current = true;
      startXRef.current = e.clientX;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const deltaX = e.clientX - startXRef.current;
      onResize(deltaX);
      startXRef.current = e.clientX;
    };

    const handleUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    handle.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleUp);

    return () => {
      handle.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleUp);
      // Cleanup cursor styles
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [onResize, isColumnBeingDragged]);

  return (
    <div
      ref={handleRef}
      className={`absolute top-0 bottom-0 transition-colors z-10 group ${
        isColumnBeingDragged 
          ? 'cursor-not-allowed opacity-30' 
          : 'cursor-col-resize hover:bg-blue-400 bg-transparent'
      }`}
      style={{ 
        right: '-12px', // Position at the middle of the 24px gap (1.5rem)
        width: '4px', // Narrow 4px width
        transform: 'translateX(-50%)' // Center the 3px handle in the gap (moves 1.5px left to perfectly center)
      }}
      title={t('kanban.resizeColumn')}
      aria-label={t('kanban.resizeColumn')}
    >
      {/* Visual indicator on hover */}
      <div className="absolute inset-0 bg-blue-400 opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  );
};

export default ColumnResizeHandle;
