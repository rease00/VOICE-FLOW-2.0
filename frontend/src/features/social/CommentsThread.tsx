import React, { useState } from 'react';
import { MessageSquare, Heart, Send, Flag, AlertCircle } from 'lucide-react';

// --- BOOK REPORTER ---
export const BookReporter: React.FC<{ bookId: string }> = ({ bookId }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState('');
  
  const submitReport = () => {
      if (!reason) return;
      alert(`Report submitted for Book ${bookId} under category: ${reason}`);
      setIsOpen(false);
  };

  if (!isOpen) {
      return (
          <button 
             onClick={() => setIsOpen(true)}
             className="flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-red-400 transition-colors py-2"
          >
              <Flag size={14} /> Report Book
          </button>
      );
  }

  return (
      <div className="bg-slate-900 border border-red-500/30 p-4 rounded-xl mt-4 w-full">
          <div className="flex items-center gap-2 text-red-400 font-bold text-sm mb-3">
              <AlertCircle size={16} /> File a Report
          </div>
          <select 
             className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-sm text-slate-200 mb-3"
             value={reason} onChange={e => setReason(e.target.value)}
          >
              <option value="" disabled>Select Reason...</option>
              <option value="copyright">Copyright Violation</option>
              <option value="inappropriate">Inappropriate Content</option>
              <option value="spam">Spam / Scam</option>
          </select>
          <div className="flex justify-end gap-2 text-xs font-semibold">
              <button className="text-slate-500 hover:text-slate-300" onClick={() => setIsOpen(false)}>Cancel</button>
              <button 
                 className="bg-red-500/20 text-red-400 px-3 py-1.5 rounded disabled:opacity-50"
                 disabled={!reason}
                 onClick={submitReport}
              >Submit Report</button>
          </div>
      </div>
  );
};

// --- COMMENTS THREAD ---
interface Comment {
    id: string;
    user: string;
    text: string;
    likes: number;
    timestamp: string;
}

export const CommentsThread: React.FC<{ targetId: string; type: 'chapter' | 'book' }> = ({ targetId, type }) => {
   const [comments, setComments] = useState<Comment[]>([
       { id: '1', user: 'NovelLover99', text: 'This chapter was absolutely wild! Waiting for the next one.', likes: 12, timestamp: '2 hours ago' },
       { id: '2', user: 'CriticX', text: 'I feel like the pacing was a bit too fast here.', likes: 4, timestamp: '5 hours ago' }
   ]);
   const [newComment, setNewComment] = useState('');

   const handleAddComment = () => {
       if (!newComment.trim()) return;
       setComments(prev => [{
           id: Date.now().toString(),
           user: 'Current User', 
           text: newComment,
           likes: 0,
           timestamp: 'Just now'
       }, ...prev]);
       setNewComment('');
   };

   return (
       <div className="flex flex-col gap-4 max-w-2xl mx-auto w-full pt-8">
           <h3 className="text-xl font-bold flex items-center gap-2 text-slate-100 mb-4">
               <MessageSquare size={20} className="text-indigo-400" /> 
               {type === 'chapter' ? 'Chapter Comments' : 'Book Reviews'} ({comments.length})
           </h3>
           
           <div className="flex flex-col gap-2 relative">
               <textarea 
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-4 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors resize-none h-24"
                  placeholder="Share your thoughts..."
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
               />
               <div className="absolute right-3 bottom-3 flex gap-2">
                   <button 
                      onClick={handleAddComment}
                      disabled={!newComment.trim()}
                      className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 p-2 rounded-full text-white transition-colors"
                   >
                       <Send size={14} />
                   </button>
               </div>
           </div>

           <div className="flex flex-col gap-4 mt-6">
               {comments.map(c => (
                   <div key={c.id} className="flex gap-4">
                       <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center font-bold text-slate-400 shrink-0">
                           {c.user[0]}
                       </div>
                       <div className="flex flex-col flex-1">
                           <div className="flex items-center gap-2 mb-1">
                               <span className="font-semibold text-sm text-slate-200">{c.user}</span>
                               <span className="text-xs text-slate-500">{c.timestamp}</span>
                           </div>
                           <p className="text-sm text-slate-300 leading-relaxed">{c.text}</p>
                           <div className="flex items-center gap-4 mt-2">
                               <button className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-indigo-400 transition-colors">
                                   <Heart size={14} /> {c.likes}
                               </button>
                               <button className="text-xs font-semibold text-slate-500 hover:text-slate-300 transition-colors">
                                   Reply
                               </button>
                           </div>
                       </div>
                   </div>
               ))}
           </div>
       </div>
   );
};
