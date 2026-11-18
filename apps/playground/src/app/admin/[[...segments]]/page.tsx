import "xenon-cms/styles.css";
import config from "@/xenon.config";
import { AdminPage, type AdminActionInput, type AdminPageProps, runAdminAction } from "xenon-cms/next";

export const metadata = { title: "Xenon Admin" };

async function action(input: AdminActionInput) {
  "use server";
  return runAdminAction(config, input);
}

export default function Page(props: Pick<AdminPageProps, "params" | "searchParams">) {
  return <AdminPage config={config} action={action} {...props} />;
}
