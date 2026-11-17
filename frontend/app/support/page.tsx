'use client'

import { useTranslations } from 'next-intl'
import { motion } from 'framer-motion'
import Navigation from '@/components/Navigation'
import Footer from '@/components/Footer'
import { Mail, MessageCircle, HelpCircle, ArrowRight, Sparkles, Clock, ExternalLink } from 'lucide-react'
import Link from 'next/link'

export default function SupportPage() {
    const t = useTranslations('Support')
    return (
        <>
            <Navigation />
            <main className="bg-gray-50 min-h-screen">
                {/* Hero Section */}
                <section className="bg-white border-b border-gray-100 px-4 py-20 md:py-28 relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/50 via-white to-purple-50/30" />

                    <div className="max-w-4xl mx-auto text-center relative z-10">
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.6 }}
                        >
                            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-600 text-sm font-medium mb-6">
                                <HelpCircle className="w-3.5 h-3.5" />
                                {t('helpSupport')}
                            </div>

                            <h1 className="text-4xl md:text-6xl font-bold mb-6 leading-tight text-gray-900">
                                How can we{' '}
                                <span className="bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                                    {t('helpYou')}
                                </span>
                            </h1>

                            <p className="text-lg text-gray-500 max-w-2xl mx-auto leading-relaxed">
                                Our mission is to make your studio management effortless. Whether you have a question,
                                need technical help, or want to suggest a feature, we&apos;re here for you.
                            </p>
                        </motion.div>
                    </div>
                </section>

                {/* Support Options */}
                <section className="px-4 py-20">
                    <div className="max-w-4xl mx-auto">
                        <div className="grid md:grid-cols-2 gap-6">
                            {/* Email Support */}
                            <motion.div
                                initial={{ opacity: 0, x: -20 }}
                                whileInView={{ opacity: 1, x: 0 }}
                                viewport={{ once: true }}
                                className="bg-white rounded-2xl border border-gray-100 p-8 hover:shadow-lg transition-all"
                            >
                                <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-6">
                                    <Mail className="w-6 h-6" />
                                </div>
                                <h2 className="text-2xl font-bold text-gray-900 mb-2">{t('emailSupport')}</h2>
                                <p className="text-gray-500 mb-6 text-sm leading-relaxed">
                                    {t('theBestWayToGetTechnicalHelpOrAccountAssistanceWeTypicalyRespondWithin24Hours')}
                                </p>
                                <a
                                    href="mailto:tristan@fddl.dev"
                                    className="inline-flex items-center gap-2 text-indigo-600 font-semibold hover:gap-3 transition-all"
                                >
                                    tristan@fddl.dev
                                    <ArrowRight className="w-4 h-4" />
                                </a>
                                <div className="mt-8 pt-6 border-t border-gray-50 flex items-center gap-2 text-xs text-gray-400">
                                    <Clock className="w-3.5 h-3.5" />
                                    {t('responseTime2448Hours')}
                                </div>
                            </motion.div>

                            {/* Community / Docs */}
                            <motion.div
                                initial={{ opacity: 0, x: 20 }}
                                whileInView={{ opacity: 1, x: 0 }}
                                viewport={{ once: true }}
                                className="bg-white rounded-2xl border border-gray-100 p-8 hover:shadow-lg transition-all"
                            >
                                <div className="w-12 h-12 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center mb-6">
                                    <MessageCircle className="w-6 h-6" />
                                </div>
                                <h2 className="text-2xl font-bold text-gray-900 mb-2">{t('documentation')}</h2>
                                <p className="text-gray-500 mb-6 text-sm leading-relaxed">
                                    {t('detailedGuidesOnEverythingFromSettingUpYourStudioToAdvancedBillingAndCustomDomains')}
                                </p>
                                <Link
                                    href="/docs"
                                    className="inline-flex items-center gap-2 text-purple-600 font-semibold hover:gap-3 transition-all"
                                >
                                    {t('browseTheGuides')}
                                    <ArrowRight className="w-4 h-4" />
                                </Link>
                                <div className="mt-8 pt-6 border-t border-gray-50 flex items-center gap-2 text-xs text-gray-400">
                                    <ExternalLink className="w-3.5 h-3.5" />
                                    {t('selfServiceKnowledgeBase')}
                                </div>
                            </motion.div>
                        </div>

                        {/* Additional Info */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            className="mt-12 bg-gray-900 rounded-2xl p-8 md:p-10 text-white relative overflow-hidden"
                        >
                            <div className="absolute inset-0 bg-gradient-to-br from-indigo-600/20 via-transparent to-purple-600/20" />
                            <div className="relative flex flex-col md:flex-row items-center justify-between gap-8">
                                <div>
                                    <div className="flex items-center gap-2 mb-3">
                                        <Sparkles className="w-5 h-5 text-amber-400" />
                                        <span className="text-sm font-semibold uppercase tracking-wider text-gray-400">{t('premiumSupport')}</span>
                                    </div>
                                    <h3 className="text-2xl font-bold mb-2">{t('needPriorityAssistance')}</h3>
                                    <p className="text-gray-400 text-sm max-w-md">
                                        {t('professionalAndEnterprisePlansIncludeDedicatedSupportWith4HourResponseTimesDuringBusinessHours')}
                                    </p>
                                </div>
                                <Link
                                    href="/pricing"
                                    className="px-6 py-3.5 bg-white text-gray-900 rounded-xl font-bold hover:bg-gray-100 transition-colors whitespace-nowrap"
                                >
                                    {t('seePlans')}
                                </Link>
                            </div>
                        </motion.div>
                    </div>
                </section>
            </main>
            <Footer />
        </>
    )
}
