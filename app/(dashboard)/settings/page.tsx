
export default function SettingsPage() {
  return (
    <div className="flex-1 w-full flex flex-col items-center">

      <div className="flex flex-col gap-8 w-full max-w-5xl px-5 py-8">
        <div>
          <h1 className="text-2xl font-medium">Settings</h1>
          <p className="text-sm text-foreground/60 mt-1">
            Manage your application preferences
          </p>
        </div>

        <div className="rounded-md border p-6">
          <h2 className="font-medium mb-4">Connection</h2>
          <div className="space-y-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="port" className="text-sm">
                Listening Port
              </label>
              <input
                id="port"
                type="number"
                defaultValue="6881"
                className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-foreground/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="maxPeers" className="text-sm">
                Max Peers per Torrent
              </label>
              <input
                id="maxPeers"
                type="number"
                defaultValue="50"
                className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-foreground/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
              />
            </div>
          </div>
        </div>

        <div className="rounded-md border p-6">
          <h2 className="font-medium mb-4">Bandwidth</h2>
          <div className="space-y-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="downloadLimit" className="text-sm">
                Download Limit (KB/s)
              </label>
              <input
                id="downloadLimit"
                type="number"
                defaultValue="0"
                placeholder="0 = unlimited"
                className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-foreground/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="uploadLimit" className="text-sm">
                Upload Limit (KB/s)
              </label>
              <input
                id="uploadLimit"
                type="number"
                defaultValue="0"
                placeholder="0 = unlimited"
                className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-foreground/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
              />
            </div>
          </div>
        </div>

        <div className="rounded-md border p-6">
          <h2 className="font-medium mb-4">Interface</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm">Theme</p>
                <p className="text-sm text-foreground/60">
                  Toggle between light and dark mode using the button in the
                  header or footer
                </p>
              </div>
            </div>
          </div>
        </div>

        <button className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium w-fit hover:bg-primary/90 transition-colors">
          Save Settings
        </button>
      </div>
    </div>
  );
}
