#[derive(Debug, Clone)]
pub struct LeagueClientCredentials {
    pub port: u16,
    pub auth_token: String,
}

pub struct LeagueClient {
    credentials: LeagueClientCredentials,
}

impl LeagueClient {
    pub fn new(credentials: LeagueClientCredentials) -> Self {
        Self { credentials }
    }

    pub fn base_url(&self) -> String {
        format!("https://127.0.0.1:{}", self.credentials.port)
    }
}
