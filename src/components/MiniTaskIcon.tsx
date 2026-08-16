import React from 'react';
import { Task, TeamMember } from '../types';
import MemberAvatar from './ui/MemberAvatar';

interface MiniTaskIconProps {
  task: Task;
  member?: TeamMember;
  className?: string;
}

const MiniTaskIcon: React.FC<MiniTaskIconProps> = ({ task, member, className = '' }) => {
  return (
    <div 
      className={`
        w-8 h-8 rounded-lg bg-white border-2 border-blue-400 shadow-lg 
        flex items-center justify-center text-xs font-bold text-gray-700
        transform transition-all duration-200 cursor-grabbing
        ${className}
      `}
      title={task.title}
    >
      {member ? (
        <MemberAvatar member={member} size="sm" />
      ) : (
        <span className="text-blue-600">
          {task.title.charAt(0).toUpperCase()}
        </span>
      )}
    </div>
  );
};

export default MiniTaskIcon;
