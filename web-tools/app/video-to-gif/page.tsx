import ToolPage, { toolMetadata } from '@/components/ToolPage';
import VideoToGif from '@/components/tools/VideoToGif';

export const metadata = toolMetadata('video-to-gif');

export default function Page() {
  return (
    <ToolPage slug="video-to-gif">
      <VideoToGif />
    </ToolPage>
  );
}
