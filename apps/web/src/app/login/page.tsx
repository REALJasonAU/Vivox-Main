"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Mail, Lock, ArrowRight } from "lucide-react";
import { signIn } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { AuthShell, Field } from "@/components/auth-shell";

const fieldVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
};

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirect = params.get("redirect") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error } = await signIn.email({ email, password });
      if (error) {
        setError(error.message ?? "Invalid email or password.");
        return;
      }
      router.push(redirect);
      router.refresh();
    } catch {
      setError("Could not reach the authentication service.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.form
      onSubmit={onSubmit}
      className="flex flex-col gap-4"
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
      }}
    >
      <motion.div variants={fieldVariants}>
        <Field
          id="login-email"
          icon={<Mail className="size-4" />}
          type="email"
          label="Email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          required
        />
      </motion.div>
      <motion.div variants={fieldVariants}>
        <Field
          id="login-password"
          icon={<Lock className="size-4" />}
          type="password"
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          required
        />
      </motion.div>
      {error && (
        <motion.p
          variants={fieldVariants}
          className="rounded-xl border border-crashed/30 bg-crashed/10 px-3 py-2 text-sm text-crashed"
        >
          {error}
        </motion.p>
      )}
      <motion.div variants={fieldVariants}>
        <Button type="submit" size="lg" loading={loading} className="mt-1 w-full justify-center">
          Sign in <ArrowRight className="size-4" />
        </Button>
      </motion.div>
    </motion.form>
  );
}

export default function LoginPage() {
  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your Vivox workspace."
      footer={
        <>
          New here?{" "}
          <Link href="/register" className="text-vivox-400 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <Suspense fallback={<div className="h-44" />}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
