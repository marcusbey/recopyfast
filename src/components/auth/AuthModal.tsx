"use client";

import { useState } from "react";
import {
  Dialog,
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
      <DialogContent className="sm:max-w-[425px] bg-white border border-gray-200 rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center text-gray-900">
            Welcome to ReCopyFast
          </DialogTitle>
          <DialogDescription className="text-center text-gray-600">
            Get instant access with a magic link sent to your email
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-6">
          <TabsList className="grid w-full grid-cols-2 bg-gray-100 rounded-lg p-1">
            <TabsTrigger
              value="login"
              className="text-gray-600 data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm rounded-md font-medium"
            >
              Sign In
            </TabsTrigger>
            <TabsTrigger
              value="signup"
              className="text-gray-600 data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm rounded-md font-medium"
            >
              Sign Up
            </TabsTrigger>
          </TabsList>

          <TabsContent value="login" className="mt-6">
            <LoginForm onSwitchToSignup={() => setActiveTab("signup")} />
          </TabsContent>

          <TabsContent value="signup" className="mt-6">
            <SignupForm onSwitchToLogin={() => setActiveTab("login")} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
