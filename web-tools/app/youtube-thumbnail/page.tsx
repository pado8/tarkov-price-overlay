import ToolPage, { toolMetadata } from '@/components/ToolPage';
import YoutubeThumbnail from '@/components/tools/YoutubeThumbnail';

export const metadata = toolMetadata('youtube-thumbnail');

export default function Page() {
  return (
    <ToolPage slug="youtube-thumbnail">
      <YoutubeThumbnail />
    </ToolPage>
  );
}
