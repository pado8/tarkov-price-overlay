import ToolPage, { toolMetadata } from '@/components/ToolPage';
import HeicToJpg from '@/components/tools/HeicToJpg';

export const metadata = toolMetadata('heic-to-jpg');

export default function Page() {
  return (
    <ToolPage slug="heic-to-jpg">
      <HeicToJpg />
    </ToolPage>
  );
}
