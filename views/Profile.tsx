
import React from 'react';
import { AppScreen } from '../types';
import { ArrowLeft } from 'lucide-react';
import { useUser } from '../contexts/UserContext';

export const Profile: React.FC<{ setScreen: (s: AppScreen) => void }> = ({ setScreen }) => {
    const { user, stats } = useUser();
    return (
        <div className="min-h-screen bg-gray-50 p-6 flex items-center justify-center">
            <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-200 p-6 relative animate-fade-in-up">
                <button onClick={() => setScreen(AppScreen.MAIN)} className="absolute top-6 left-6 text-gray-400 hover:text-gray-900"><ArrowLeft size={20}/></button>
                
                <div className="text-center mt-8">
                    <div className="w-20 h-20 bg-indigo-100 rounded-full mx-auto mb-4 overflow-hidden">
                         {user.avatarUrl ? <img src={user.avatarUrl} className="w-full h-full object-cover"/> : null}
                    </div>
                    <h2 className="text-xl font-bold">{user.name}</h2>
                    <p className="text-sm text-gray-500">{user.email}</p>
                    
                    <div className="mt-6 p-4 bg-gray-50 rounded-xl border border-gray-100">
                        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Current Plan</h3>
                        <div className="flex justify-between items-center">
                            <span className="font-bold text-indigo-600">{stats.isPremium ? 'PRO Plan' : 'Free Plan'}</span>
                            <span className="text-sm font-mono text-gray-600">{stats.generationsUsed} / {stats.generationsLimit} Gens</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
