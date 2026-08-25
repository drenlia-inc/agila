import React, { useEffect, useState, useRef } from 'react';

interface GanttTask {
  id: string;
  title: string;
  startDate: Date | null;
  endDate: Date | null;
  ticket: string;
  columnId: string;
  status: string;
  priority: string;
  columnPosition: number;
  taskPosition: number;
}

interface TaskRelationship {
  id: string;
  task_id: string;
  relationship: 'parent' | 'child' | 'related';
  to_task_id: string;
  task_ticket: string;
  related_task_ticket: string;
}

interface TaskPosition {
  x: number;
  y: number;
  width: number;
  height: number;
  taskId: string;
}

interface TaskDependencyArrowsProps {
  ganttTasks: GanttTask[];
  taskPositions: Map<string, {x: number, y: number, width: number, height: number}>;                                                                           
  isRelationshipMode?: boolean;
  onCreateRelationship?: (fromTaskId: string, toTaskId: string) => void;
  onDeleteRelationship?: (relationshipId: string, fromTaskId: string) => void;
  relationships?: TaskRelationship[]; // Add relationships prop for auto-sync
  dateRange?: { date: Date }[]; // Add date range for position calculation
  taskViewMode?: 'compact' | 'shrink' | 'expand';
  dayColumnWidth?: number;
}

interface DependencyArrow {
  id: string;
  relationshipId: string;
  fromTaskId: string;
  toTaskId: string;
  relationship: 'parent' | 'child' | 'related';
  fromPosition: TaskPosition;
  toPosition: TaskPosition;
  path: string;
  color: string;
}

interface PendingArrow {
  id: string;
  relationshipId: string;
  fromTaskId: string;
  toTaskId: string;
  relationship: 'parent' | 'related';
  fromPos: TaskPosition;
  toPos: TaskPosition;
  color: string;
}

const BAR_HEIGHT = 24;
const GAP_RATIO = 1.5;
const LANE_X_STEP = 12;
const LANE_Y_STEP = 10;
const TYPE_Y_OFFSET = 8;
const TRUNK_Y_TOLERANCE = 6;
const BAR_PADDING_INSET = 4;
const PATH_CORNER_RADIUS = 5;

/** Orthogonal path with slightly rounded corners (quadratic beziers at each bend). */
const roundedOrthogonalPath = (
  points: Array<{ x: number; y: number }>,
  radius = PATH_CORNER_RADIUS
): string => {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  const cornerRadius = (index: number): number => {
    const prev = points[index - 1];
    const curr = points[index];
    const next = points[index + 1];
    const lenIn = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const lenOut = Math.hypot(next.x - curr.x, next.y - curr.y);
    if (lenIn === 0 || lenOut === 0) return 0;
    return Math.min(radius, lenIn / 2, lenOut / 2);
  };

  const last = points.length - 1;
  const rStart = cornerRadius(1);
  const p0 = points[0];
  const p1 = points[1];
  const dx01 = p1.x - p0.x;
  const dy01 = p1.y - p0.y;
  const len01 = Math.hypot(dx01, dy01) || 1;

  let path = `M ${p0.x} ${p0.y} L ${p1.x - (dx01 / len01) * rStart} ${p1.y - (dy01 / len01) * rStart}`;

  for (let i = 1; i < last; i++) {
    const curr = points[i];
    const next = points[i + 1];
    const ri = cornerRadius(i);
    const dxOut = next.x - curr.x;
    const dyOut = next.y - curr.y;
    const lenOut = Math.hypot(dxOut, dyOut) || 1;
    const outX = curr.x + (dxOut / lenOut) * ri;
    const outY = curr.y + (dyOut / lenOut) * ri;

    path += ` Q ${curr.x} ${curr.y} ${outX} ${outY}`;

    if (i < last - 1) {
      const riNext = cornerRadius(i + 1);
      path += ` L ${next.x - (dxOut / lenOut) * riNext} ${next.y - (dyOut / lenOut) * riNext}`;
    }
  }

  path += ` L ${points[last].x} ${points[last].y}`;
  return path;
};

const getBarBounds = (pos: { y: number; height: number }) => {
  const barTop = pos.y + Math.max(0, (pos.height - BAR_HEIGHT) / 2);
  return { barTop, barBottom: barTop + BAR_HEIGHT, barCenter: barTop + BAR_HEIGHT / 2 };
};

/** Vertical center of the padding band below the bar (inside the row, away from the border). */
const lowerPaddingCenter = (pos: { y: number; height: number }) => {
  const { barBottom } = getBarBounds(pos);
  const rowBottom = pos.y + pos.height;
  return barBottom + (rowBottom - barBottom) * 0.5;
};

/** Vertical center of the padding band above the bar (inside the row, away from the border). */
const upperPaddingCenter = (pos: { y: number; height: number }) => {
  const { barTop } = getBarBounds(pos);
  return pos.y + (barTop - pos.y) * 0.5;
};

const isAdjacentRow = (fromPos: TaskPosition, toPos: TaskPosition, goingDown: boolean) => {
  if (goingDown) {
    return Math.abs(toPos.y - (fromPos.y + fromPos.height)) < 2;
  }
  return Math.abs(fromPos.y - (toPos.y + toPos.height)) < 2;
};

const clampRouteY = (
  routeY: number,
  arrow: PendingArrow,
  goingDown: boolean
): number => {
  const fromBar = getBarBounds(arrow.fromPos);
  const toBar = getBarBounds(arrow.toPos);
  const sameRow = Math.abs(arrow.fromPos.y - arrow.toPos.y) < 1;

  if (goingDown) {
    const minY = fromBar.barBottom + BAR_PADDING_INSET;
    const maxY = sameRow
      ? arrow.fromPos.y + arrow.fromPos.height - BAR_PADDING_INSET
      : toBar.barTop - BAR_PADDING_INSET;
    return Math.max(minY, Math.min(routeY, maxY));
  }

  const maxY = fromBar.barTop - BAR_PADDING_INSET;
  const minY = sameRow
    ? arrow.fromPos.y + BAR_PADDING_INSET
    : toBar.barBottom + BAR_PADDING_INSET;
  return Math.min(maxY, Math.max(routeY, minY));
};

/** Spread connection points along the bar edge so multiple lines do not share one anchor. */
const endpointYOnBar = (pos: { y: number; height: number }, slot: number, total: number): number => {
  const { barTop, barCenter } = getBarBounds(pos);
  if (total <= 1) return barCenter;

  const inset = 4;
  const usable = BAR_HEIGHT - inset * 2;
  if (total === 2) {
    return slot === 0 ? barTop + inset + usable * 0.25 : barTop + inset + usable * 0.75;
  }
  return barTop + inset + (slot / (total - 1)) * usable;
};

/** Assign lane indices per task for outgoing (right edge) and incoming (left edge) lines. */
const assignConnectionLanes = (pending: PendingArrow[]) => {
  const outgoing = new Map<string, PendingArrow[]>();
  const incoming = new Map<string, PendingArrow[]>();

  pending.forEach((arrow) => {
    if (!outgoing.has(arrow.fromTaskId)) outgoing.set(arrow.fromTaskId, []);
    if (!incoming.has(arrow.toTaskId)) incoming.set(arrow.toTaskId, []);
    outgoing.get(arrow.fromTaskId)!.push(arrow);
    incoming.get(arrow.toTaskId)!.push(arrow);
  });

  const sortByTargetY = (a: PendingArrow, b: PendingArrow) =>
    a.toPos.y - b.toPos.y || a.toTaskId.localeCompare(b.toTaskId);
  const sortBySourceY = (a: PendingArrow, b: PendingArrow) =>
    a.fromPos.y - b.fromPos.y || a.fromTaskId.localeCompare(b.fromTaskId);

  const fromLane = new Map<string, number>();
  const toLane = new Map<string, number>();

  outgoing.forEach((group) => {
    group.sort(sortByTargetY);
    group.forEach((arrow, index) => fromLane.set(arrow.id, index));
  });

  incoming.forEach((group) => {
    group.sort(sortBySourceY);
    group.forEach((arrow, index) => toLane.set(arrow.id, index));
  });

  return { fromLane, toLane, outgoing, incoming };
};

interface RouteDraft {
  arrow: PendingArrow;
  fromLane: number;
  toLane: number;
  outgoingCount: number;
  incomingCount: number;
  fromY: number;
  toY: number;
  fromX: number;
  toX: number;
  stepOutX: number;
  approachX: number;
  routeY: number;
}

/** Route horizontal trunks through bar padding bands — never on row border lines. */
const computeBaseRouteY = (
  arrow: PendingArrow,
  fromY: number,
  toY: number,
  fromLane: number
): number => {
  const goingDown = toY >= fromY;
  const typeOffset = arrow.relationship === 'related' ? TYPE_Y_OFFSET : 0;
  const laneOffset = fromLane * LANE_Y_STEP;
  const sameRow = Math.abs(arrow.fromPos.y - arrow.toPos.y) < 1;

  let routeY: number;

  if (sameRow || isAdjacentRow(arrow.fromPos, arrow.toPos, goingDown)) {
    // Adjacent rows share a border pixel — stay inside source row padding
    routeY = goingDown
      ? lowerPaddingCenter(arrow.fromPos) + laneOffset + typeOffset
      : upperPaddingCenter(arrow.fromPos) - laneOffset - typeOffset;
  } else {
    const fromBar = getBarBounds(arrow.fromPos);
    const toBar = getBarBounds(arrow.toPos);
    // Bias 35 % from source bar toward target bar — avoids landing on row boundaries
    if (goingDown) {
      routeY = fromBar.barBottom + (toBar.barTop - fromBar.barBottom) * 0.35 + laneOffset + typeOffset;
    } else {
      routeY = toBar.barTop + (fromBar.barBottom - toBar.barTop) * 0.35 - laneOffset - typeOffset;
    }
  }

  return clampRouteY(routeY, arrow, goingDown);
};

/** Bump trunk Y when horizontal segments overlap in the same X band. */
const deconflictTrunkLanes = (drafts: RouteDraft[]): Map<string, number> => {
  const bumps = new Map<string, number>();
  const placed: { y: number; xMin: number; xMax: number }[] = [];
  const sorted = [...drafts].sort((a, b) => a.routeY - b.routeY || a.arrow.id.localeCompare(b.arrow.id));

  sorted.forEach((draft) => {
    const xMin = Math.min(draft.stepOutX, draft.approachX);
    const xMax = Math.max(draft.stepOutX, draft.approachX);
    const goingDown = draft.toY >= draft.fromY;
    let bump = 0;
    const triedY = new Set<number>();

    for (let attempt = 0; attempt < 16; attempt++) {
      const signedBump = goingDown ? bump : -bump;
      const candidateY = clampRouteY(draft.routeY + signedBump, draft.arrow, goingDown);
      if (triedY.has(candidateY)) {
        bump += LANE_Y_STEP;
        continue;
      }
      triedY.add(candidateY);

      const conflict = placed.some(
        (segment) =>
          Math.abs(candidateY - segment.y) < TRUNK_Y_TOLERANCE &&
          xMin < segment.xMax &&
          xMax > segment.xMin
      );
      if (!conflict) {
        placed.push({ y: candidateY, xMin, xMax });
        bumps.set(draft.arrow.id, candidateY - draft.routeY);
        break;
      }
      bump += LANE_Y_STEP;
    }
  });

  return bumps;
};

const buildRouteDraft = (
  arrow: PendingArrow,
  fromLane: number,
  toLane: number,
  outgoingCount: number,
  incomingCount: number,
  columnWidth: number
): RouteDraft => {
  const gap = columnWidth * GAP_RATIO;
  const fromY = endpointYOnBar(arrow.fromPos, fromLane, outgoingCount);
  const toY = endpointYOnBar(arrow.toPos, toLane, incomingCount);
  const fromX = arrow.fromPos.x + arrow.fromPos.width;
  const toX = arrow.toPos.x;
  const stepOutX = fromX + gap + fromLane * LANE_X_STEP;
  const approachX = toX - gap - toLane * LANE_X_STEP;
  const routeY = computeBaseRouteY(arrow, fromY, toY, fromLane);

  return {
    arrow,
    fromLane,
    toLane,
    outgoingCount,
    incomingCount,
    fromY,
    toY,
    fromX,
    toX,
    stepOutX,
    approachX,
    routeY,
  };
};

const buildArrowPathFromDraft = (draft: RouteDraft, trunkBump = 0): string => {
  const { fromX, fromY, toX, toY, stepOutX, approachX, arrow } = draft;
  const goingDown = toY >= fromY;
  const routeY = clampRouteY(draft.routeY + trunkBump, arrow, goingDown);

  return roundedOrthogonalPath([
    { x: fromX, y: fromY },
    { x: stepOutX, y: fromY },
    { x: stepOutX, y: routeY },
    { x: approachX, y: routeY },
    { x: approachX, y: toY },
    { x: toX, y: toY },
  ]);
};

const TaskDependencyArrows: React.FC<TaskDependencyArrowsProps> = ({
  ganttTasks,
  taskPositions,
  isRelationshipMode = false,
  onCreateRelationship,
  onDeleteRelationship,
  relationships = [],
  dateRange = [],
  taskViewMode = 'expand',
  dayColumnWidth = 40,
}) => {
  
  
  const [localRelationships, setLocalRelationships] = useState<TaskRelationship[]>([]);
  const [arrows, setArrows] = useState<DependencyArrow[]>([]);
  const [hoveredArrow, setHoveredArrow] = useState<string | null>(null);
  const [hoverDeletePoint, setHoverDeletePoint] = useState<{ x: number; y: number } | null>(null);
  const [positionKey, setPositionKey] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);

  /** Match visible stroke (3px) with a small tolerance — not a wide grab band. */
  const ARROW_HIT_STROKE_WIDTH = 6;

  const clientToSvgPoint = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const svgPt = pt.matrixTransform(ctm.inverse());
    return { x: svgPt.x, y: svgPt.y };
  };

  const clearArrowHover = () => {
    setHoveredArrow(null);
    setHoverDeletePoint(null);
  };

  // Connection drawing state (simplified for icon-based approach)
  // const [hoveredTask, setHoveredTask] = useState<string | null>(null);

  // Trigger position recalculation when tasks change or view mode changes
  useEffect(() => {
    const timer = setTimeout(() => {
      setPositionKey(prev => prev + 1);
    }, 50); // Small delay to ensure DOM is updated
    return () => clearTimeout(timer);
  }, [ganttTasks.length, taskViewMode]); // Depend on task count and view mode

  // Listen for scroll events to recalculate arrows when timeline changes
  useEffect(() => {
    const timelineContainer = document.querySelector('.gantt-timeline-container');
    if (!timelineContainer) return;

    let scrollTimeout: NodeJS.Timeout;
    
    const handleScroll = () => {
      clearTimeout(scrollTimeout);
      // Debounce scroll events to reduce unnecessary recalculations
      scrollTimeout = setTimeout(() => {
        setPositionKey(prev => prev + 1);
      }, 150); // Balanced debounce time
    };

    timelineContainer.addEventListener('scroll', handleScroll);
    
    return () => {
      timelineContainer.removeEventListener('scroll', handleScroll);
      clearTimeout(scrollTimeout);
    };
  }, []);

  // Use relationships from props (auto-synced via polling) - KEEP THIS IMPROVEMENT
  useEffect(() => {
    if (ganttTasks.length === 0) {
      setLocalRelationships([]);
      return;
    }

    // Filter to only show relationships between visible tasks
    const visibleTaskIds = new Set(ganttTasks.map(t => t.id));
    const visibleRelationships = relationships.filter(rel => {
      // Support both camelCase (from API) and snake_case (from optimistic updates)
      const taskId = rel.taskId || rel.task_id;
      const toTaskId = rel.toTaskId || rel.to_task_id;
      return visibleTaskIds.has(taskId) && visibleTaskIds.has(toTaskId);
    });

    setLocalRelationships(visibleRelationships);
  }, [ganttTasks, relationships]);



  // Calculate arrows based on relationships using actual task positions from DOM
  useEffect(() => {
    if (!localRelationships || !ganttTasks || taskPositions.size === 0) {
      return;
    }

    const pending: PendingArrow[] = [];
    const processedPairs = new Set<string>();

    localRelationships.forEach((rel) => {
      const taskId = rel.taskId || rel.task_id;
      const toTaskId = rel.toTaskId || rel.to_task_id;
      const fromTask = ganttTasks.find((t) => t.id === taskId);
      const toTask = ganttTasks.find((t) => t.id === toTaskId);

      if (!fromTask || !toTask) return;

      if (rel.relationship === 'parent') {
        const pairKey = `parent:${taskId}-${toTaskId}`;
        if (processedPairs.has(pairKey)) return;
        processedPairs.add(pairKey);

        const fromPosRaw = taskPositions.get(fromTask.id);
        const toPosRaw = taskPositions.get(toTask.id);
        if (!fromPosRaw || !toPosRaw) return;

        pending.push({
          id: `${rel.id}-${pairKey}`,
          relationshipId: rel.id,
          fromTaskId: taskId,
          toTaskId,
          relationship: 'parent',
          fromPos: { ...fromPosRaw, taskId: fromTask.id },
          toPos: { ...toPosRaw, taskId: toTask.id },
          color: '#3B82F6',
        });
      } else if (rel.relationship === 'related') {
        const pairKey = `related:${[taskId, toTaskId].sort().join('-')}`;
        if (processedPairs.has(pairKey)) return;
        processedPairs.add(pairKey);

        const fromPosRaw = taskPositions.get(fromTask.id);
        const toPosRaw = taskPositions.get(toTask.id);
        if (!fromPosRaw || !toPosRaw) return;

        pending.push({
          id: `${rel.id}-${pairKey}`,
          relationshipId: rel.id,
          fromTaskId: taskId,
          toTaskId,
          relationship: 'related',
          fromPos: { ...fromPosRaw, taskId: fromTask.id },
          toPos: { ...toPosRaw, taskId: toTask.id },
          color: '#CA8A04',
        });
      }
    });

    const { fromLane, toLane, outgoing, incoming } = assignConnectionLanes(pending);

    const drafts = pending.map((arrow) => {
      const outLane = fromLane.get(arrow.id) ?? 0;
      const inLane = toLane.get(arrow.id) ?? 0;
      const outCount = outgoing.get(arrow.fromTaskId)?.length ?? 1;
      const inCount = incoming.get(arrow.toTaskId)?.length ?? 1;
      return buildRouteDraft(arrow, outLane, inLane, outCount, inCount, dayColumnWidth);
    });

    const trunkBumps = deconflictTrunkLanes(drafts);

    const newArrows: DependencyArrow[] = drafts.map((draft) => ({
      id: draft.arrow.id,
      relationshipId: draft.arrow.relationshipId,
      fromTaskId: draft.arrow.fromTaskId,
      toTaskId: draft.arrow.toTaskId,
      relationship: draft.arrow.relationship,
      fromPosition: draft.arrow.fromPos,
      toPosition: draft.arrow.toPos,
      path: buildArrowPathFromDraft(draft, trunkBumps.get(draft.arrow.id) ?? 0),
      color: draft.arrow.color,
    }));

    setArrows(newArrows);
  }, [localRelationships, ganttTasks, taskPositions, positionKey, dayColumnWidth]);

  // Arrow marker definition
  const ArrowMarker = ({ id, color }: { id: string; color: string }) => (
    <defs>
      <marker
        id={id}
        viewBox="0 0 10 10"
        refX="9"
        refY="3"
        markerWidth="6"
        markerHeight="6"
        orient="auto"
        markerUnits="strokeWidth"
      >
        <path d="M0,0 L0,6 L9,3 z" fill={color} />
      </marker>
    </defs>
  );


  return (
    <div 
      className="absolute inset-0 pointer-events-none"
      style={{ 
        zIndex: 10,
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%'
      }}
    >
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          overflow: 'visible'
        }}
      >
      {/* Define arrow markers for each color */}
      <ArrowMarker id="arrow-parent" color="#3B82F6" />
      <ArrowMarker id="arrow-child" color="#10B981" />

      {/* SVG overlays no longer needed - using link icons instead */}

      {/* Connection drawing no longer needed - using simple click approach */}

      {/* Render topmost hit targets last so overlapping arrows prefer the upper one */}
      {arrows.map((arrow) => {
        const isHovered = hoveredArrow === arrow.id;
        return (
        <g key={`arrow-${arrow.id}`}>
          {/* Visible arrow */}
          <path
            d={arrow.path}
            stroke={arrow.color}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity={
              isHovered
                ? arrow.relationship === 'related'
                  ? 1
                  : 0.85
                : arrow.relationship === 'related'
                  ? 0.75
                  : 0.5
            }
            strokeDasharray={arrow.relationship === 'related' ? '6 4' : undefined}
            fill="none"
            markerEnd={arrow.relationship === 'related' ? undefined : `url(#arrow-${arrow.relationship})`}
            pointerEvents="none"
          />

          {/* Precise hit target — only this stroke receives pointer events */}
          <path
            d={arrow.path}
            stroke="transparent"
            strokeWidth={ARROW_HIT_STROKE_WIDTH}
            fill="none"
            className={onDeleteRelationship ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none'}
            onMouseMove={(e) => {
              const pt = clientToSvgPoint(e.clientX, e.clientY);
              if (pt) {
                setHoverDeletePoint(pt);
              }
              setHoveredArrow(arrow.id);
            }}
            onMouseLeave={clearArrowHover}
            onClick={(e) => {
              if (!onDeleteRelationship) return;
              e.stopPropagation();
              e.preventDefault();
              clearArrowHover();
              onDeleteRelationship(arrow.relationshipId, arrow.fromTaskId);
            }}
          />

          {/* Visual delete hint at cursor — no extra hit box (click the line) */}
          {isHovered && hoverDeletePoint && onDeleteRelationship && (
            <g pointerEvents="none" aria-hidden>
              <circle
                cx={hoverDeletePoint.x}
                cy={hoverDeletePoint.y}
                r="5"
                fill="rgba(239, 68, 68, 0.95)"
                stroke="white"
                strokeWidth="1"
              />
              <text
                x={hoverDeletePoint.x}
                y={hoverDeletePoint.y + 1}
                textAnchor="middle"
                dominantBaseline="central"
                fill="white"
                fontSize="8"
                fontWeight="bold"
              >
                ×
              </text>
            </g>
          )}
        </g>
        );
      })}

    </svg>
    </div>
  );
};

export default TaskDependencyArrows;