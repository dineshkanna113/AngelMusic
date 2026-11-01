import { findPeople, FriendsList, useActivity } from "../components/FriendsRail";
import { PageHeader } from "../components/Grid";

export default function Friends() {
  const friends = useActivity();
  return (
    <div className="max-w-2xl">
      <PageHeader title="Friends" subtitle="What the people you follow are playing.">
        <button type="button" className="btn-social h-9 px-4" onClick={findPeople}>Find people</button>
      </PageHeader>
      <FriendsList friends={friends} />
    </div>
  );
}
