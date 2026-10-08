"use client";

import { useState } from "react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LoginForm } from "./LoginForm";
import { SignupForm } from "./SignupForm";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: "login" | "signup";
}

export function AuthModal({
  isOpen,
  onClose,
  defaultTab = "login",
}: AuthModalProps) {
  const [activeTab, setActiveTab] = useState<string>(defaultTab);

  // No success callback is wired into the forms on purpose. With magic links
  // nothing succeeds while the modal is open — the user only signs in once
  // they click the emailed link, by which point this dialog is long gone.
  // Closing on "link sent" would just hide the instructions they need.
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Welcome to ReCopyFast</DialogTitle>
          <DialogDescription>
            Get instant access with a magic link sent to your email
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="login">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Sign up</TabsTrigger>
            </TabsList>

            <TabsContent value="login" className="mt-6">
              <LoginForm onSwitchToSignup={() => setActiveTab("signup")} />
            </TabsContent>

            <TabsContent value="signup" className="mt-6">
              <SignupForm onSwitchToLogin={() => setActiveTab("login")} />
            </TabsContent>
          </Tabs>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
