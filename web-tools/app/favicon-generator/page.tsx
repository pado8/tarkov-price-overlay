import ToolPage, { toolMetadata } from '@/components/ToolPage';
import FaviconGenerator from '@/components/tools/FaviconGenerator';

export const metadata = toolMetadata('favicon-generator');

export default function Page() {
  return (
    <ToolPage slug="favicon-generator">
      <FaviconGenerator />
    </ToolPage>
  );
}
