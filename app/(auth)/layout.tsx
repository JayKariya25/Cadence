export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-5 py-16">
      {children}
    </div>
  );
}
