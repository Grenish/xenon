"use client";
import NextLink from "next/link";
import { usePathname as useNextPathname, useRouter as useNextRouter } from "next/navigation";
import { type ReactNode, useMemo } from "react";
import { type AdminLinkProps, type AdminRouter, AdminRouterProvider } from "xenon-cms/client";

function Link(props: AdminLinkProps) {
  return <NextLink {...props} />;
}

/**
 * Next.js App Router adapter for `<AdminRouterProvider>`.
 * Lives in its own internal `"use client"` bundle (`xenon-cms/next-client`) so `xenon-cms/client`
 * never imports `next/link` or `next/navigation`.
 */
export function NextAdminRouter({ children }: { children: ReactNode }) {
  const nextRouter = useNextRouter();
  const router = useMemo<AdminRouter>(
    () => ({
      Link,
      usePathname: useNextPathname,
      push: (href, options) => nextRouter.push(href, options),
      replace: (href, options) => nextRouter.replace(href, options),
      refresh: () => nextRouter.refresh(),
    }),
    [nextRouter],
  );
  return <AdminRouterProvider router={router}>{children}</AdminRouterProvider>;
}
