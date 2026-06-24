"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Mail, Lock, User as UserIcon, ArrowRight } from "lucide-react";
import { signUp } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { AuthShell, Field } from "@/components/auth-shell";

const fieldVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
};

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await signUp.email({ name, email, password });
      if (error) {
        setError(error.message ?? "Could not create the account.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Could not reach the authentication service.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle="Spin up your first service in minutes."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="text-vivox-400 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
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
            id="register-name"
            icon={<UserIcon className="size-4" />}
            type="text"
            label="Full name"
            value={name}
            onChange={setName}
            autoComplete="name"
            required
          />
        </motion.div>
        <motion.div variants={fieldVariants}>
          <Field
            id="register-email"
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
            id="register-password"
            icon={<Lock className="size-4" />}
            type="password"
            label="Password (min. 8 characters)"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
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
            Create account <ArrowRight className="size-4" />
          </Button>
        </motion.div>
      </motion.form>
    </AuthShell>
  );
}
