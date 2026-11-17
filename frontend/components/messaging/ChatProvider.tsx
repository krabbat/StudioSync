"use client";

import React, { useEffect, useState, ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Chat, useCreateChatClient } from "stream-chat-react";
import "stream-chat-react/dist/css/v2/index.css";
import { useUser } from "@/contexts/UserContext";
import { useAppearance } from "@/contexts/AppearanceContext";
import api from "@/services/api";

type ChatProviderProps = {
    children: ReactNode;
};

type ChatClientProviderProps = {
    children: ReactNode;
    user: any;
    token: string;
    apiKey: string;
};

const ChatClientProvider: React.FC<ChatClientProviderProps> = ({ children, user, token, apiKey }) => {
    const { theme } = useAppearance();
    const client = useCreateChatClient({
        apiKey: apiKey,
        tokenOrProvider: token,
        userData: {
            id: user.id || "unknown",
            name: `${user.first_name || ""} ${user.last_name || ""}`.trim() || 'User',
            image: user.avatar,
        }
    });

    if (!client) {
        return (
            <div className="flex w-full h-full items-center justify-center p-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
        );
    }

    const isDark = theme === 'dark' || (theme === 'auto' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const streamTheme = isDark ? 'str-chat__theme-dark' : 'str-chat__theme-light';

    return (
        <Chat client={client} theme={streamTheme}>
            {children}
        </Chat>
    );
};

export const ChatProvider: React.FC<ChatProviderProps> = ({ children }) => {
    const tr = useTranslations("ChatProvider");
    const { currentUser: user } = useUser();
    const [token, setToken] = useState<string | null>(null);
    const [apiKey, setApiKey] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [configurationMissing, setConfigurationMissing] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) return;

        let mounted = true;

        const fetchToken = async () => {
            try {
                const response = await api.get("/messaging/token/");
                if (mounted && response.data?.token && response.data?.apiKey) {
                    setToken(response.data.token);
                    setApiKey(response.data.apiKey);
                } else if (mounted) {
                    setError(tr('invalidResponse'))
                }
            } catch (err: any) {
                if (mounted) {
                    const missingKeys = err?.response?.data?.error === "Stream Chat API keys are not configured.";
                    setConfigurationMissing(missingKeys);
                    setError(missingKeys ? tr('missingKeys') : tr('requestFailed', { status: String(err?.response?.status ?? '?') }));
                    // The server can intentionally return 500 for missing integration keys.
                    // Avoid logging a handled AxiosError as an uncaught Next.js dev-overlay error.
                    console.warn("Messaging token request failed", {
                        status: err?.response?.status,
                        reason: err?.response?.data?.error
                    });
                }
            } finally {
                if (mounted) setLoading(false);
            }
        };

        fetchToken();

        return () => {
            mounted = false;
        };
    }, [user]);

    if (!user || loading) {
        return (
            <div className="flex w-full h-full items-center justify-center p-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
        );
    }

    if (error || !token || !apiKey) {
        return (
            <div className="flex w-full h-full items-center justify-center p-8">
                <div className="text-center max-w-sm">
                    <p className="text-gray-500 text-sm">{error || tr('unavailable')}</p>
                    <p className="text-gray-400 text-xs mt-2">
                        {configurationMissing ? (
                            <>
                                {tr('configureIntro')} <code className="bg-gray-100 px-1 rounded">STREAM_API_KEY</code> {tr('and')} <code className="bg-gray-100 px-1 rounded">STREAM_API_SECRET</code> {tr('configureOutro')}
                            </>
                        ) : tr('checkBackend')}
                    </p>
                </div>
            </div>
        );
    }

    return <ChatClientProvider user={user} token={token} apiKey={apiKey}>{children}</ChatClientProvider>;
};
