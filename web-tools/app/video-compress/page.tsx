import ToolPage, { toolMetadata } from '@/components/ToolPage';
import VideoCompress from '@/components/tools/VideoCompress';

export const metadata = toolMetadata('video-compress');

export default function Page() {
  return (
    <ToolPage slug="video-compress">
      <VideoCompress />
    </ToolPage>
  );
}
