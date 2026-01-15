
import React, { useState } from 'react';
import { X, Check, CreditCard, ShieldCheck, Loader2, Crown } from 'lucide-react';
import { Button } from './Button';
import { useUser } from '../contexts/UserContext';

export const SubscriptionModal: React.FC = () => {
  const { showSubscriptionModal, setShowSubscriptionModal, updateStats } = useUser();
  const [step, setStep] = useState<'plan' | 'payment' | 'success'>('plan');
  const [isLoading, setIsLoading] = useState(false);

  if (!showSubscriptionModal) return null;

  const handleClose = () => {
    setShowSubscriptionModal(false);
    setTimeout(() => setStep('plan'), 300); // Reset after transition
  };

  const handlePayment = () => {
    setIsLoading(true);
    // Mock payment processing
    setTimeout(() => {
      setIsLoading(false);
      setStep('success');
      updateStats({
        isPremium: true,
        generationsLimit: 9999,
        generationsUsed: 0,
        planName: 'Pro'
      });
    }, 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-md sm:rounded-3xl rounded-t-3xl overflow-hidden shadow-2xl relative max-h-[90vh] overflow-y-auto">
        
        {/* Close Button */}
        <button 
          onClick={handleClose}
          className="absolute top-4 right-4 p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors z-10"
        >
          <X size={20} className="text-gray-600" />
        </button>

        {step === 'plan' && (
          <div className="p-6 pt-12">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-gradient-to-br from-amber-400 to-orange-500 rounded-2xl mx-auto flex items-center justify-center shadow-lg shadow-orange-200 mb-4">
                <Crown size={32} className="text-white" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900">Upgrade to Pro</h2>
              <p className="text-gray-500 mt-2">Unlock the full power of AI voices.</p>
            </div>

            <div className="space-y-4 mb-8">
              <div className="flex items-center gap-3 p-3 bg-indigo-50 rounded-xl border border-indigo-100">
                <div className="bg-indigo-100 p-1.5 rounded-full"><Check size={14} className="text-[#8b5cf6]" /></div>
                <span className="text-gray-700 font-medium text-sm">Unlimited Generations</span>
              </div>
              <div className="flex items-center gap-3 p-3 bg-indigo-50 rounded-xl border border-indigo-100">
                <div className="bg-indigo-100 p-1.5 rounded-full"><Check size={14} className="text-[#8b5cf6]" /></div>
                <span className="text-gray-700 font-medium text-sm">Access to All Premium Voices</span>
              </div>
              <div className="flex items-center gap-3 p-3 bg-indigo-50 rounded-xl border border-indigo-100">
                <div className="bg-indigo-100 p-1.5 rounded-full"><Check size={14} className="text-[#8b5cf6]" /></div>
                <span className="text-gray-700 font-medium text-sm">Commercial Usage Rights</span>
              </div>
            </div>

            <div className="bg-gray-900 rounded-2xl p-5 text-white relative overflow-hidden mb-6">
               <div className="relative z-10 flex justify-between items-center">
                  <div>
                    <p className="text-gray-400 text-xs uppercase tracking-wider font-bold">Monthly Plan</p>
                    <div className="flex items-baseline gap-1 mt-1">
                      <span className="text-3xl font-bold">$9.99</span>
                      <span className="text-gray-400">/mo</span>
                    </div>
                  </div>
                  <div className="bg-white/10 px-3 py-1 rounded-lg text-xs font-semibold">
                    Most Popular
                  </div>
               </div>
            </div>

            <Button fullWidth onClick={() => setStep('payment')}>
              Continue to Checkout
            </Button>
          </div>
        )}

        {step === 'payment' && (
          <div className="p-6 pt-8">
            <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
              <CreditCard size={24} className="text-[#8b5cf6]" /> Payment Details
            </h2>
            
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); handlePayment(); }}>
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 uppercase">Card Number</label>
                <input type="text" placeholder="4242 4242 4242 4242" className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#8b5cf6] outline-none font-mono" />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-500 uppercase">Expiry</label>
                  <input type="text" placeholder="MM/YY" className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#8b5cf6] outline-none font-mono" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-500 uppercase">CVC</label>
                  <input type="text" placeholder="123" className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#8b5cf6] outline-none font-mono" />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 uppercase">Cardholder Name</label>
                <input type="text" placeholder="John Doe" className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#8b5cf6] outline-none" />
              </div>

              <div className="pt-4">
                <Button fullWidth disabled={isLoading} className="shadow-xl shadow-indigo-200">
                   {isLoading ? <Loader2 className="animate-spin" /> : 'Pay $9.99'}
                </Button>
              </div>
              
              <div className="flex items-center justify-center gap-2 text-xs text-gray-400 mt-4">
                <ShieldCheck size={12} /> Secure encrypted transaction
              </div>
            </form>
          </div>
        )}

        {step === 'success' && (
          <div className="p-8 flex flex-col items-center text-center animate-in zoom-in duration-300">
             <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-6">
               <Check size={40} strokeWidth={3} />
             </div>
             <h2 className="text-2xl font-bold text-gray-900 mb-2">Upgrade Successful!</h2>
             <p className="text-gray-500 mb-8">
               You now have unlimited generations and access to all premium features.
             </p>
             <Button fullWidth onClick={handleClose}>
               Start Creating
             </Button>
          </div>
        )}

      </div>
    </div>
  );
};
