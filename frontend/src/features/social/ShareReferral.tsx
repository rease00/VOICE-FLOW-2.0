'use client';

import React, { useCallback, useState } from 'react';
import { Copy, Check, Share2 } from 'lucide-react';

interface ShareReferralProps {
  referralCode: string;
  className?: string;
}

const BASE_URL = 'https://v-flow-ai.com';

export default function ShareReferral({ referralCode, className = '' }: ShareReferralProps) {
  const [copied, setCopied] = useState(false);
  const link = `${BASE_URL}/?ref=${encodeURIComponent(referralCode)}`;

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  }, [link]);

  const nativeShare = useCallback(async () => {
    if (!navigator.share) return;
    try {
      await navigator.share({
        title: 'Join V FLOW AI',
        text: 'Check out V FLOW AI for TTS, voice cloning, and novels!',
        url: link,
      });
    } catch {
      // User cancelled or not supported
    }
  }, [link]);

  const shareWhatsApp = useCallback(() => {
    const text = encodeURIComponent(`Check out V FLOW AI! ${link}`);
    window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener');
  }, [link]);

  const shareTwitter = useCallback(() => {
    const text = encodeURIComponent('Check out V FLOW AI for TTS, voice cloning, and novel publishing!');
    const url = encodeURIComponent(link);
    window.open(`https://x.com/intent/tweet?text=${text}&url=${url}`, '_blank', 'noopener');
  }, [link]);

  const shareTelegram = useCallback(() => {
    const url = encodeURIComponent(link);
    const text = encodeURIComponent('Check out V FLOW AI!');
    window.open(`https://t.me/share/url?url=${url}&text=${text}`, '_blank', 'noopener');
  }, [link]);

  return (
    <div className={`rounded-2xl border border-slate-700/60 bg-slate-900/80 p-4 sm:p-6 ${className}`}>
      <h3 className="text-base font-semibold text-slate-100 sm:text-lg">Invite Friends</h3>
      <p className="mt-1 text-xs text-slate-400 sm:text-sm">
        Earn 5,000 VF when your friend buys any plan (max 50 rewards).
      </p>

      {/* Referral link */}
      <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-700/50 bg-slate-800/60 px-3 py-2">
        <span className="flex-1 truncate text-xs text-slate-300 sm:text-sm">{link}</span>
        <button
          onClick={copyLink}
          className="flex-shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-700/60 hover:text-slate-200"
          aria-label="Copy referral link"
        >
          {copied ? (
            <Check className="h-4 w-4 text-emerald-400" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Share buttons */}
      <div className="mt-3 flex flex-wrap gap-2">
        {typeof navigator !== 'undefined' && 'share' in navigator && (
          <ShareButton onClick={nativeShare} label="Share" />
        )}
        <ShareButton onClick={shareWhatsApp} label="WhatsApp" />
        <ShareButton onClick={shareTwitter} label="X" />
        <ShareButton onClick={shareTelegram} label="Telegram" />
      </div>
    </div>
  );
}

function ShareButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-lg border border-slate-700/50 bg-slate-800/50 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-700/60 hover:text-slate-100"
    >
      <Share2 className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
