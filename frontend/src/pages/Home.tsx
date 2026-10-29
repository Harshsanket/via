import { Link } from 'react-router-dom';
import { Send, Download } from 'lucide-react';
import { Button } from '../components/ui/button';

export default function Home() {
  return (
    <div className="flex w-full flex-1 flex-col items-center">
      <section className="flex min-h-[calc(100dvh-6rem)] w-full flex-col items-center justify-center px-2 py-12 text-center">
        <h1 className="mb-5 font-serif text-7xl leading-none tracking-tight sm:text-8xl md:text-9xl">
          Via.
        </h1>

        <p className="mb-10 text-base font-light tracking-tight  sm:text-lg">
          Private, secure, peer-to-peer file transfers.
        </p>

        <div className="flex w-full max-w-xs flex-col justify-center gap-4 sm:max-w-none sm:flex-row sm:gap-6">
          <Button
            asChild
            variant="outline"
            className="h-12 w-full gap-2 border-white/15 bg-[#2E8B73] px-9 text-lg text-white hover:border-white/30 hover:bg-[#2E8B73]/90 hover:text-white sm:w-auto"
          >
            <Link to="/send">
              <Send size={22} aria-hidden="true" />
              Send
            </Link>
          </Button>

          <Button
            asChild
            variant="outline"
            className="h-12 w-full gap-2 border-white/15 bg-[#3A5A98] px-9 text-lg text-white hover:border-white/30 hover:bg-[#3A5A98]/90 hover:text-white sm:w-auto"
          >
            <Link to="/receive">
              <Download size={22} aria-hidden="true" />
              Receive
            </Link>
          </Button>
        </div>
      </section>

    </div>
  );
}
