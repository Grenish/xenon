/** The Xenon mark (X + e), drawn in currentColor so it follows the ink it sits on. */
export function XenonMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="398 728 1136 475"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      fill="currentColor"
    >
      <path d="M418 748H565L709 895L852 748H999L780 965L999 1183H852L709 1035L565 1183H418L637 965Z" />
      <path d="M1510 748H1250C1160 748 1080 775 1045 850C1028 890 1022 930 1022 965C1022 1010 1030 1070 1055 1105C1100 1165 1170 1183 1265 1183H1514V1107H1265C1205 1107 1150 1090 1137 1001H1487V930H1136C1150 840 1200 824 1265 824H1510Z" />
    </svg>
  );
}
