
import { NavLink, Link } from 'react-router-dom';
import { Search, FileText, CheckSquare, MessageSquare, Upload, Sparkles } from 'lucide-react';

const Sidebar = () => {
  const navItems = [
    { path: '/search', name: '업무 검색', icon: <Search size={20} /> },
    { path: '/sop', name: 'SOP 생성', icon: <FileText size={20} /> },
    { path: '/checklist', name: '체크리스트', icon: <CheckSquare size={20} /> },
    { path: '/cs', name: '문의 답변', icon: <MessageSquare size={20} /> },
    { path: '/upload', name: '문서 업로드', icon: <Upload size={20} /> },
  ];

  return (
    <aside className="w-64 bg-[#1C2B4B] flex flex-col h-full shadow-lg text-gray-300">
      <Link to="/search" className="h-16 flex items-center px-6 border-b border-white/10 hover:bg-white/5 transition-colors cursor-pointer">
        <Sparkles className="w-6 h-6 text-blue-400 mr-2.5" />
        <h1 className="text-2xl font-bold text-white tracking-tight">Guidely</h1>
      </Link>
      
      <nav className="flex-1 py-6 px-3 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex items-center px-3 py-3 rounded-xl transition-all duration-200 ${
                isActive
                  ? 'bg-blue-600 text-white font-medium shadow-md'
                  : 'text-gray-300 hover:bg-white/10 hover:text-white'
              }`
            }
          >
            <span className="mr-3">{item.icon}</span>
            {item.name}
          </NavLink>
        ))}
      </nav>
      
      <div className="p-4 border-t border-white/10 text-sm text-gray-400 text-center">
        &copy; 2026 Guidely
      </div>
    </aside>
  );
};

export default Sidebar;
