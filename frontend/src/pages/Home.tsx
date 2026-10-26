import { Link } from 'react-router-dom';
import { Send, Download, Zap, Shield, Network, Clock, CloudOff, Eye, Sparkles, Lock } from 'lucide-react';
import { Button } from '../components/ui/button';

export default function Home() {
  return (
    <div className="flex w-full flex-1 flex-col items-center">
      <section className="flex min-h-[calc(100dvh-6rem)] w-full flex-col items-center justify-center px-2 py-12 text-center">
        <h1 className="mb-5 font-serif text-7xl leading-none tracking-tight sm:text-8xl md:text-9xl">
          Via.
        </h1>

        <p className="mb-10 text-base font-light tracking-tight text-muted-foreground sm:text-lg">
          Free, peer-to-peer file transfers.
        </p>

        <div className="flex w-full max-w-xs flex-col justify-center gap-4 sm:max-w-none sm:flex-row sm:gap-6">
          <Button
            asChild
            variant="outline"
            className="h-12 w-full gap-2 border-[#2B2B2B] bg-[#2E8B73] px-9 text-lg text-white hover:border-[#2B2B2B] hover:bg-[#2E8B73]/90 hover:text-white sm:w-auto"
          >
            <Link to="/send">
              <Send size={22} aria-hidden="true" />
              Send
            </Link>
          </Button>

          <Button
            asChild
            variant="outline"
            className="h-12 w-full gap-2 border-[#2B2B2B] bg-[#3A5A98] px-9 text-lg text-white hover:border-[#2B2B2B] hover:bg-[#3A5A98]/90 hover:text-white sm:w-auto"
          >
            <Link to="/receive">
              <Download size={22} aria-hidden="true" />
              Receive
            </Link>
          </Button>
        </div>
      </section>

      <section className="w-full max-w-6xl px-2 py-16 sm:px-6 md:py-24">
        <div className="mx-auto mb-12 max-w-2xl text-center md:mb-16">
          <h2 className="text-3xl font-bold sm:text-4xl">
            Built for Direct, Secure Transfer
          </h2>
          <p className="mt-4 text-muted-foreground">
            Via enables temporary peer-to-peer file sharing without cloud storage,
            middlemen, or unnecessary complexity.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 md:gap-12 lg:grid-cols-4">

          <div className="group transition-transform duration-300">
            <div className="mb-3 flex items-center gap-3">
              <Network className="h-6 w-6 text-blue-500 transition-colors duration-300 group-hover:text-blue-600" />
              <h3 className="text-lg font-semibold">True Peer-to-Peer</h3>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Files move directly between users using WebRTC. No cloud storage,
              no file persistence, no unnecessary servers.
            </p>
          </div>

          <div className="group transition-transform duration-300">
            <div className="mb-3 flex items-center gap-3">
              <Shield className="h-6 w-6 text-emerald-500 transition-colors duration-300 group-hover:text-emerald-600" />
              <h3 className="text-lg font-semibold">Encrypted Channels</h3>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              WebRTC provides end-to-end encryption by default, ensuring secure
              communication between peers.
            </p>
          </div>

          <div className="group transition-transform duration-300">
            <div className="mb-3 flex items-center gap-3">
              <Clock className="h-6 w-6 text-amber-500 transition-colors duration-300 group-hover:text-amber-600" />
              <h3 className="text-lg font-semibold">Temporary Sessions</h3>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Redis-backed session TTL automatically expires inactive rooms,
              keeping transfers lightweight and secure.
            </p>
          </div>

          <div className="group transition-transform duration-300">
            <div className="mb-3 flex items-center gap-3">
              <CloudOff className="h-6 w-6 text-slate-500 transition-colors duration-300 group-hover:text-slate-600" />
              <h3 className="text-lg font-semibold">No Cloud Storage</h3>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Via does not store your files. Data exists only during active
              transfer sessions.
            </p>
          </div>

          <div className="group transition-transform duration-300">
            <div className="mb-3 flex items-center gap-3">
              <Zap className="h-6 w-6 text-yellow-500 transition-colors duration-300 group-hover:text-yellow-600" />
              <h3 className="text-lg font-semibold">High-Speed Transfer</h3>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Direct peer-to-peer connections reduce latency and eliminate
              traditional cloud upload bottlenecks.
            </p>
          </div>

          <div className="group transition-transform duration-300">
            <div className="mb-3 flex items-center gap-3">
              <Eye className="h-6 w-6 text-indigo-500 transition-colors duration-300 group-hover:text-indigo-600" />
              <h3 className="text-lg font-semibold">Transparent by Design</h3>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              No hidden uploads, background storage, or tracking layers.
              What you send is what gets transferred.{' '}
              <a
                href="https://github.com/Harshsanket/via-frontend"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-indigo-600 hover:underline"
              >
                Verify the source code →
              </a>
            </p>
          </div>

          <div className="group transition-transform duration-300">
            <div className="mb-3 flex items-center gap-3">
              <Sparkles className="h-6 w-6 text-pink-500 transition-colors duration-300 group-hover:text-pink-600" />
              <h3 className="text-lg font-semibold">Simple &amp; Instant</h3>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Create a session, share a code, and start transferring —
              no accounts, no setup, no friction.
            </p>
          </div>

          <div className="group transition-transform duration-300">
            <div className="mb-3 flex items-center gap-3">
              <Lock className="h-6 w-6 text-rose-500 transition-colors duration-300 group-hover:text-rose-600" />
              <h3 className="text-lg font-semibold">Privacy-First Architecture</h3>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Built from the ground up with privacy as a core principle,
              not added later as a marketing feature.
            </p>
          </div>

        </div>
      </section>
    </div>
  );
}
