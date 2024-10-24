const messageBar = document.querySelector(".bar-wrapper input");
const sendBtn = document.querySelector(".bar-wrapper button");
const messageBox = document.querySelector(".message-box");

let API_URL = "https://api.openai.com/v1/chat/completions";
let API_KEY = "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"

sendBtn.onclick = function () {
  if(messageBar.value.length > 0){
    const UserTypedMessage = messageBar.value;
    messageBar.value = "";

    let message =
    `<div class="chat message">
    <img src="img/user.jpg">
    <span>
      ${UserTypedMessage}
    </span>
  </div>`;

  let response = 
  `<div class="chat response">
  <img src="img/chatbot.jpg">
  <span class= "new">...
  </span>
</div>`

    messageBox.insertAdjacentHTML("beforeend", message);

    setTimeout(() =>{
      messageBox.insertAdjacentHTML("beforeend", response);

      const requestOptions = {
        method : "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
          "model": "gpt-4o-mini",
          "messages": [{"role": "user", "content": UserTypedMessage}]
        })
      }

      fetch(API_URL, requestOptions).then(res => res.json()).then(data => {
        const ChatBotResponse = document.querySelector(".response .new");
        ChatBotResponse.innerHTML = data.choices[0].message.content;
        ChatBotResponse.classList.remove("new");
      }).catch((error) => {
        ChatBotResponse.innerHTML = "Opps! An error occured. Please try again"
      })
    }, 100);
  }
}