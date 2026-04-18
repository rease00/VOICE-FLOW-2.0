'use client';

import React from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';

/* ─── Prefers reduced motion ─── */

function useReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ─── Transition variants ─── */

const pageVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0 },
};

const pageTransition = {
  duration: 0.2,
  ease: 'easeOut' as const,
};

const exitTransition = {
  duration: 0.15,
};

/* ─── Page wrapper ─── */

export function PageTransition({
  children,
  pageKey,
  className = '',
}: {
  children: React.ReactNode;
  pageKey: string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={pageKey}
        variants={pageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={pageTransition}
        className={className}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/* ─── Staggered card grid ─── */

const cardContainerVariants: Variants = {
  animate: {
    transition: { staggerChildren: 0.04 },
  },
};

const cardVariants: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.25 } },
};

export function StaggeredGrid({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;

  return (
    <motion.div
      variants={cardContainerVariants}
      initial="initial"
      animate="animate"
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function StaggeredItem({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div variants={cardVariants} className={className}>
      {children}
    </motion.div>
  );
}

/* ─── Modal animation wrapper ─── */

const modalVariants: Variants = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
};

export function ModalTransition({
  children,
  isOpen,
  className = '',
}: {
  children: React.ReactNode;
  isOpen: boolean;
  className?: string;
}) {
  const reduced = useReducedMotion();

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 bg-black/50"
          />
          {reduced ? (
            <div className={`fixed inset-0 z-50 flex items-center justify-center ${className}`}>
              {children}
            </div>
          ) : (
            <motion.div
              variants={modalVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.2 }}
              className={`fixed inset-0 z-50 flex items-center justify-center ${className}`}
            >
              {children}
            </motion.div>
          )}
        </>
      )}
    </AnimatePresence>
  );
}

/* ─── Bottom sheet (mobile) ─── */

const sheetVariants: Variants = {
  initial: { y: '100%' },
  animate: { y: 0 },
  exit: { y: '100%' },
};

const sheetSpring = { type: 'spring' as const, damping: 25, stiffness: 300 };

export function BottomSheet({
  children,
  isOpen,
  onClose,
  className = '',
}: {
  children: React.ReactNode;
  isOpen: boolean;
  onClose?: () => void;
  className?: string;
}) {
  const reduced = useReducedMotion();

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/50"
          />
          {reduced ? (
            <div
              className={`fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-slate-900 ${className}`}
            >
              {children}
            </div>
          ) : (
            <motion.div
              variants={sheetVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={sheetSpring}
              className={`fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-slate-900 ${className}`}
            >
              {children}
            </motion.div>
          )}
        </>
      )}
    </AnimatePresence>
  );
}

/* ─── Tab content slide ─── */

export function TabSlide({
  children,
  direction = 1,
  tabKey,
  className = '',
}: {
  children: React.ReactNode;
  direction?: 1 | -1;
  tabKey: string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={tabKey}
        initial={{ x: 20 * direction, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: -20 * direction, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className={className}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
