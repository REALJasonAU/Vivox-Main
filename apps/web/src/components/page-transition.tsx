"use client";

import { motion, AnimatePresence } from "framer-motion";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const variants = {
  initial: { opacity: 0, x: 10, y: 4 },
  animate: { opacity: 1, x: 0, y: 0 },
  exit: { opacity: 0, x: -6, y: 0 },
};

export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        variants={variants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={{
          duration: 0.22,
          ease: [0.16, 1, 0.3, 1],
        }}
        style={{ willChange: "opacity, transform" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
