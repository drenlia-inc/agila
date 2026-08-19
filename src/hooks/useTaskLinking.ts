/**
 * Hook for managing task linking state
 */

import { useState } from 'react';
import { Task } from '../types';

export interface UseTaskLinkingReturn {
  // Linking state
  isLinkingMode: boolean;
  setIsLinkingMode: (mode: boolean) => void;
  linkingSourceTask: Task | null;
  setLinkingSourceTask: (task: Task | null) => void;
  linkingLine: { startX: number; startY: number; endX: number; endY: number } | null;
  setLinkingLine: (line: { startX: number; startY: number; endX: number; endY: number } | null) => void;
  /** True while linking if Shift selects a related link (live during drag). */
  linkingWantRelated: boolean;
  setLinkingWantRelated: (wantRelated: boolean) => void;

  // Hover highlighting
  hoveredLinkTask: Task | null;
  setHoveredLinkTask: (task: Task | null) => void;

  // Relationships
  taskRelationships: { [taskId: string]: any[] };
  setTaskRelationships: (relationships: { [taskId: string]: any[] }) => void;
  boardRelationships: any[];
  setBoardRelationships: (relationships: any[]) => void;
}

export const useTaskLinking = (): UseTaskLinkingReturn => {
  const [isLinkingMode, setIsLinkingMode] = useState(false);
  const [linkingSourceTask, setLinkingSourceTask] = useState<Task | null>(null);
  const [linkingLine, setLinkingLine] = useState<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null>(null);
  const [linkingWantRelated, setLinkingWantRelated] = useState(false);

  const [hoveredLinkTask, setHoveredLinkTask] = useState<Task | null>(null);
  const [taskRelationships, setTaskRelationships] = useState<{ [taskId: string]: any[] }>({});
  const [boardRelationships, setBoardRelationships] = useState<any[]>([]);

  return {
    isLinkingMode,
    setIsLinkingMode,
    linkingSourceTask,
    setLinkingSourceTask,
    linkingLine,
    setLinkingLine,
    linkingWantRelated,
    setLinkingWantRelated,
    hoveredLinkTask,
    setHoveredLinkTask,
    taskRelationships,
    setTaskRelationships,
    boardRelationships,
    setBoardRelationships,
  };
};
