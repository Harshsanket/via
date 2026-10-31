export default function Footer() {
  return (
    <footer className="w-full px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 text-center text-xs sm:px-6 sm:text-sm">
      <p className="font-extralight tracking-tight">
        <a
          href="https://github.com/harshsanket"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          a <span className="font-bold">Harsh Sanket</span> production
        </a>
      </p>
    </footer>
  );
}
