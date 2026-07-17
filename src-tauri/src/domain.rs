use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Protocol {
    Tcp,
    Udp,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BindingState {
    Listening,
    Connected,
    Unknown,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Access {
    Allowed,
    Restricted,
}

impl Access {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Allowed => "allowed",
            Self::Restricted => "restricted",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortBinding {
    pub id: String,
    pub protocol: Protocol,
    pub local_address: String,
    pub port: u16,
    pub state: BindingState,
    pub pid: Option<u32>,
    pub process_name: Option<String>,
    pub user_name: Option<String>,
    pub access: Access,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessDetails {
    pub pid: u32,
    pub name: String,
    pub executable_path: Option<String>,
    pub user_name: Option<String>,
    pub command_line: Option<String>,
    pub access: Access,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminateRequest {
    pub pid: u32,
    pub protocol: Protocol,
    pub local_address: String,
    pub port: u16,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminationResult {
    pub pid: u32,
    pub terminated: bool,
}
