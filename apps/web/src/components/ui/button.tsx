"use client";

import {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  useState,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg" | "icon";

export type ActionType =
  | "deploy"
  | "start"
  | "stop"
  | "restart"
  | "delete"
  | "save"
  | "copy"
  | "download"
  | "upload"
  | "none";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  actionType?: ActionType;
  successMs?: number;
}

const variants: Record<Variant, string> = {
  primary:
    "bg-vivox-500 text-white hover:bg-vivox-600 border border-vivox-500/50 shadow-sm shadow-vivox-500/20",
  secondary: "bg-surface-raised text-foreground hover:bg-surface-raised border border-border",
  outline: "border border-border text-foreground hover:bg-surface hover:border-border-focus",
  ghost: "text-muted hover:bg-surface-raised hover:text-foreground",
  danger: "bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-sm gap-2",
  icon: "h-9 w-9 justify-center",
};

const actionAnimClass: Partial<Record<ActionType, string>> = {
  deploy: "animate-rocket-thrust",
  restart: "animate-spin-once",
  save: "animate-spin-once",
  download: "animate-bounce-down",
  upload: "animate-bounce-up",
  delete: "animate-trash-lid",
  copy: "animate-copy-flash",
  start: "animate-play-ripple",
  stop: "animate-stop-implode",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      loading,
      actionType = "none",
      successMs = 1200,
      children,
      disabled,
      onClick,
      ...props
    },
    ref,
  ) => {
    const [animKey, setAnimKey] = useState(0);
    const [showSuccess, setShowSuccess] = useState(false);

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      if (actionType !== "none") {
        setAnimKey((k) => k + 1);
        if (actionType === "save" || actionType === "copy") {
          setShowSuccess(true);
          setTimeout(() => setShowSuccess(false), successMs);
        }
      }
      onClick?.(e);
    };

    const iconAnimClass =
      actionType !== "none" && animKey > 0 ? actionAnimClass[actionType] : undefined;

    const {
      onDrag: _onDrag,
      onDragStart: _onDragStart,
      onDragEnd: _onDragEnd,
      onAnimationStart: _onAnimationStart,
      ...restProps
    } = props;

    return (
      <motion.button
        ref={ref}
        disabled={disabled || loading}
        whileHover={!disabled && !loading ? { scale: 1.02, y: -0.5 } : {}}
        whileTap={!disabled && !loading ? { scale: 0.96 } : {}}
        transition={{ type: "spring", stiffness: 500, damping: 25 }}
        className={cn(
          "inline-flex select-none items-center rounded-lg font-medium transition-colors duration-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vivox-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:cursor-not-allowed disabled:opacity-45",
          variants[variant],
          sizes[size],
          variant === "danger" && "hover:animate-glow-danger",
          className,
        )}
        onClick={handleClick}
        {...restProps}
      >
        {loading && <Loader2 className="size-4 animate-spin" />}
        <AnimatedButtonContent
          iconAnimClass={iconAnimClass}
          animKey={animKey}
          showSuccess={showSuccess}
          actionType={actionType}
        >
          {children}
        </AnimatedButtonContent>
      </motion.button>
    );
  },
);
Button.displayName = "Button";

function AnimatedButtonContent({
  children,
  iconAnimClass,
  animKey,
  showSuccess,
  actionType,
}: {
  children: ReactNode;
  iconAnimClass?: string;
  animKey: number;
  showSuccess: boolean;
  actionType: ActionType;
}) {
  if ((actionType === "save" || actionType === "copy") && showSuccess) {
    return (
      <AnimatePresence mode="wait">
        <motion.span
          key="success"
          initial={{ scale: 0, rotate: -45 }}
          animate={{ scale: 1, rotate: 0 }}
          exit={{ scale: 0 }}
          transition={{ type: "spring", stiffness: 600, damping: 20 }}
          className="inline-flex items-center gap-2"
        >
          <Check className="size-4 text-emerald-400" />
          <span className="text-emerald-400">{actionType === "copy" ? "Copied" : "Saved"}</span>
        </motion.span>
      </AnimatePresence>
    );
  }

  if (!iconAnimClass) return <>{children}</>;

  const childArray = Children.toArray(children);
  const animated = childArray.map((child, i) => {
    if (i === 0 && isValidElement(child)) {
      const el = child as ReactElement<{ className?: string }>;
      return cloneElement(el, {
        key: `${animKey}-icon`,
        className: cn(el.props.className, iconAnimClass),
      });
    }
    return child;
  });

  return (
    <span key={animKey} className="inline-flex items-center gap-2">
      {animated}
    </span>
  );
}
