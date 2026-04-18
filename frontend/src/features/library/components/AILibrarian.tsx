import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Loader2, BookOpen, User } from 'lucide-react';
import { createLibrarianChat } from '../services/librarianService';
import { ChatMessage } from '../model/types';
import { Chat } from '@google/genai';

export function AILibrarian() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'model',
      text: "Hello! I am the V Flow Librarian. I can help you discover great books, analyze themes, or discuss literary history. What are you in the mood for today?",
      timestamp: Date.now()
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const chatSession = useRef<Chat | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatSession.current = createLibrarianChat();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: input,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      if (!chatSession.current) {
         chatSession.current = createLibrarianChat();
      }

      if (chatSession.current) {
        const result = await chatSession.current.sendMessage({ message: userMessage.text });
        const text = result.text || "I apologize, but I couldn't generate a response. Please try again.";
        
        const aiMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'model',
          text: text,
          timestamp: Date.now()
        };
        setMessages(prev => [...prev, aiMessage]);
      } else {
        throw new Error("API Key missing or connection failed");
      }
    } catch (error) {
      console.error("Chat error", error);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'model',
        text: "I apologize, but I'm unable to access my knowledge base right now. Please ensure your API key is configured correctly.",
        timestamp: Date.now()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const renderMessageContent = (text: string) => {
    const lines = text.split('\n');
    return lines.map((line, i) => {
      const parts = line.split(/(\*\*.*?\*\*)/g);
      const rendered = parts.map((part, j) => {
        const boldMatch = part.match(/^\*\*(.*)\*\*$/);
        if (boldMatch) {
          return <strong key={j}>{boldMatch[1]}</strong>;
        }
        return part;
      });
      return (
        <React.Fragment key={i}>
          {i > 0 && <br />}
          {rendered}
        </React.Fragment>
      );
    });
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-140px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#2f4f83] bg-[#0d1c3f] shadow-xl md:h-[600px]">
      <div className="flex items-center gap-3 bg-[#10244c] p-4 text-white">
        <div className="rounded-full bg-blue-300/20 p-2">
          <Sparkles className="w-5 h-5" />
        </div>
        <div>
          <h2 className="font-serif font-bold text-lg">V Flow Librarian</h2>
          <p className="text-blue-200 text-xs">Powered by Gemini</p>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto bg-[#09162f] p-4">
        {messages.map((msg) => (
          <div 
            key={msg.id} 
            className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
          >
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
              msg.role === 'user' ? 'bg-[#1d3768] text-slate-200' : 'bg-blue-600/20 text-blue-200'
            }`}>
              {msg.role === 'user' ? <User className="w-4 h-4" /> : <BookOpen className="w-4 h-4" />}
            </div>
            <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
              msg.role === 'user' 
                ? 'rounded-tr-none bg-[#1d3768] text-slate-100' 
                : 'rounded-tl-none border border-[#35588f] bg-[#0f2148] text-slate-200 shadow-sm'
            }`}>
              <div>{renderMessageContent(msg.text)}</div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600/20 text-blue-200">
              <BookOpen className="w-4 h-4" />
            </div>
            <div className="flex items-center gap-2 rounded-2xl rounded-tl-none border border-[#35588f] bg-[#0f2148] px-4 py-3 shadow-sm">
              <Loader2 className="h-4 w-4 animate-spin text-blue-300" />
              <span className="text-xs text-slate-400">Thinking...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-[#2f4f83] bg-[#0f2148] p-4">
        {messages.length <= 1 && !isLoading && (
          <div className="mb-3 flex flex-wrap gap-2">
            {[
              { emoji: '😊', label: 'Feel-good', prompt: 'Recommend me a feel-good classic novel that will lift my spirits' },
              { emoji: '🔮', label: 'Mysterious', prompt: 'Suggest a classic mystery or gothic novel with suspense and intrigue' },
              { emoji: '💕', label: 'Romantic', prompt: 'Recommend a beautiful classic love story from the public domain' },
              { emoji: '⚔️', label: 'Adventure', prompt: 'Suggest an exciting adventure classic with action and exploration' },
              { emoji: '🤔', label: 'Philosophical', prompt: 'Recommend a thought-provoking philosophical classic that makes you think deeply' },
              { emoji: '😱', label: 'Spooky', prompt: 'Suggest a classic horror or supernatural tale that will give me chills' },
            ].map((mood) => (
              <button
                key={mood.label}
                onClick={() => { setInput(mood.prompt); }}
                className="rounded-full border border-[#35588f] bg-[#10244c] px-3 py-1.5 text-xs text-slate-200 transition hover:bg-[#1d3768] hover:border-blue-400/50"
              >
                {mood.emoji} {mood.label}
              </button>
            ))}
          </div>
        )}
        <form onSubmit={handleSend} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask for recommendations or literary analysis..."
            className="flex-1 rounded-xl border border-[#35588f] bg-[#10244c] px-4 py-3 text-slate-100 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button 
            type="submit"
            disabled={!input.trim() || isLoading}
            className="rounded-xl bg-blue-600 px-6 py-3 font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
