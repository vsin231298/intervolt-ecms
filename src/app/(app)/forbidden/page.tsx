import Link from "next/link";

export default function Forbidden() {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <h1 className="text-xl font-semibold">You don&apos;t have access to this page</h1>
      <p className="mt-2 text-sm text-slate-500">Your role does not include this area. If you need access, ask an administrator.</p>
      <Link href="/" className="btn btn-primary mt-6">Go to my home page</Link>
    </div>
  );
}
