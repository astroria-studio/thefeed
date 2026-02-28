/**
 * TheFeed Configuration
 * Copy this to thefeed.config.ts and customize
 */

export interface TheFeedConfig {
  site: {
    name: string;
    tagline: string;
    description: string;
    url: string;
    mediaUrl: string;
    locale: string;
    author: string;
  };
  github: {
    repo: string;
    branch: string;
  };
  features: {
    jokes: boolean;
    stream: boolean;
    search: boolean;
  };
  social?: {
    twitter?: string;
    telegram?: string;
    youtube?: string;
    github?: string;
  };
}

const config: TheFeedConfig = {
  site: {
    name: "TheFeed",
    tagline: "Your content feed, your way",
    description: "A modern content platform for indie creators and makers",
    url: "https://your-domain.com",
    mediaUrl: "https://media.your-domain.com",
    locale: "en",
    author: "Your Name",
  },
  github: {
    repo: "your-username/your-repo",
    branch: "main",
  },
  features: {
    jokes: true,
    stream: true,
    search: true,
  },
  social: {
    twitter: "@yourhandle",
    telegram: "yourchannel",
    youtube: "",
    github: "yourusername",
  },
};

export default config;
