import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorCardProps {
  message: string;
  onRetry?: () => void;
  className?: string;
}

const ErrorCard: React.FC<ErrorCardProps> = ({ message, onRetry, className = '' }) => {
  return (
    <div className={`bg-red-50 border border-red-200 text-red-700 p-5 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between shadow-sm gap-4 ${className}`}>
      <div className="flex items-start">
        <AlertCircle className="w-5 h-5 mr-3 flex-shrink-0 mt-0.5 text-red-500" />
        <p className="font-medium">{message}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center justify-center px-4 py-2 bg-white border border-red-200 text-red-600 rounded-xl hover:bg-red-50 transition-colors text-sm font-medium flex-shrink-0"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          다시 시도
        </button>
      )}
    </div>
  );
};

export default ErrorCard;
